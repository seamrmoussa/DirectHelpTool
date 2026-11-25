import { Component, OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ApiCalling } from '../../api-calling';
import {
  Subscription,
  catchError,
  concatMap,
  filter,
  forkJoin,
  from,
  interval,
  map,
  of,
  switchMap,
  toArray,
} from 'rxjs';

interface ExtensionFlowResponse {
  ok?: boolean;
  token?: string;
  error?: string;
}

interface VersionResponse {
  version: string;
  builtAt?: string;
}

export interface DistributedOrderItem {
  trackNumber: string;
  visaNameEn: string;
  applicantsCount: number;
  bgColor: string;
}

export interface EmployeeColumn {
  index: number;
  name: string;
  items: DistributedOrderItem[];
  totalApplicants: number;
  targetApplicants: number;
}

@Component({
  imports: [],
  selector: 'app-request-actions',
  styleUrl: './request-actions.css',
  templateUrl: './request-actions.html',
})
export class RequestActions implements OnInit, OnDestroy {
  private readonly apiCall = inject(ApiCalling);
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly extensionId = 'jmmhkombpbjgkokbdkbgkcjifohagene';
  private isAutoSyncing = false;

  private currentBuildVersion: string | null = null;
  private isReloadingForNewBuild = false;
  private versionPollSub?: Subscription;

  readonly token = signal<string>('');
  readonly fromDate = signal<string>(this.getTodayIsoDate());
  readonly toDate = signal<string>(this.addBusinessDaysSkipFriSat(this.getTodayIsoDate(), 3));

  readonly isFetchingToken = signal<boolean>(false);
  readonly isRunningBatch = signal<boolean>(false);
  readonly statusMessage = signal<string>('');
  readonly isError = signal<boolean>(false);
  readonly apiResult = signal<unknown>(null);

  readonly searchTrackNumber = signal<string>('');
  readonly isRunningSingleOrder = signal<boolean>(false);
  private readonly documentKeys: readonly string[] = [
    'bank_statement',
    'job_letter',
    'national_family_id',
    'sponsor_passport_copy',
    'sponsor_parents_passports',
    'previous_visa_copies',
    'whatsapp_reminder_check',
  ];

  readonly employeeCount = signal<number>(4);
  readonly isDistributing = signal<boolean>(false);
  readonly isDistributionModalOpen = signal<boolean>(false);
  readonly distributionColumns = signal<EmployeeColumn[]>([]);
  readonly copiedColumnIndex = signal<number | null>(null);

  private readonly countryPriorityOrder: readonly string[] = [
    'united states',
    'austria',
    'germany',
    'czechia',
    'czech republic',
    'sweden',
    'greece',
    'switzerland',
    'norway',
    'hungary',
    'denmark',
    'italy',
    'france',
    'portugal',
    'spain',
    'cyprus',
    'the netherlands',
    'netherlands',
    'turkey',
    'türkiye',
    'united kingdom',
    'ireland',
    'canada',
  ];

  private readonly messageHandler = (event: MessageEvent) => {
    if (event.data?.type === 'EXT_TOKEN_READY' && event.data.token) {
      this.setToken(event.data.token);
      this.isError.set(false);
      this.statusMessage.set('Token received from extension.');
    }
  };

  private readonly visibilityHandler = () => {
    if (!this.isBrowser) return;

    if (document.visibilityState === 'visible') {
      this.checkForNewBuild();
      this.autoRefreshTokenAndRequests();
    }
  };

  ngOnInit(): void {
    this.resetDatesToDefault();

    if (this.isBrowser) {
      window.addEventListener('message', this.messageHandler);
      document.addEventListener('visibilitychange', this.visibilityHandler);
      this.startBuildVersionWatcher();
      this.fetchTokenFromExtension((ok) => {
        if (ok) {
          this.sendGetRequest();
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.versionPollSub?.unsubscribe();
    if (this.isBrowser) {
      window.removeEventListener('message', this.messageHandler);
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  private startBuildVersionWatcher(): void {
    this.http
      .get<VersionResponse>(`/version.json?t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' },
      })
      .subscribe({
        next: (res) => {
          if (res?.version) {
            this.currentBuildVersion = res.version;
          }
        },
        error: () => {},
      });

    this.versionPollSub = interval(60_000).subscribe(() => {
      this.checkForNewBuild();
    });
  }

  private checkForNewBuild(): void {
    if (
      !this.isBrowser ||
      this.isReloadingForNewBuild ||
      !this.currentBuildVersion ||
      this.isRunningBatch() ||
      this.isRunningSingleOrder()
    ) {
      return;
    }

    this.http
      .get<VersionResponse>(`/version.json?t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' },
      })
      .pipe(filter((res) => Boolean(res?.version)))
      .subscribe({
        next: (res) => {
          if (res.version !== this.currentBuildVersion) {
            this.isReloadingForNewBuild = true;
            window.location.reload();
          }
        },
        error: () => {},
      });
  }

  onFromDateChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    if (!val) return;
    this.fromDate.set(val);
    this.toDate.set(this.addBusinessDaysSkipFriSat(val, 3));
  }

  onToDateChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    if (val) this.toDate.set(val);
  }

  resetDatesToDefault(): void {
    const today = this.getTodayIsoDate();
    this.fromDate.set(today);
    this.toDate.set(this.addBusinessDaysSkipFriSat(today, 3));
  }

  private autoRefreshTokenAndRequests(): void {
    if (
      this.isAutoSyncing ||
      this.isFetchingToken() ||
      this.isRunningBatch() ||
      this.isRunningSingleOrder()
    ) {
      return;
    }

    this.isAutoSyncing = true;

    this.fetchTokenFromExtension((ok) => {
      if (ok) {
        this.sendGetRequest();
      }
      this.isAutoSyncing = false;
    });
  }

  fetchTokenFromExtension(onDone?: (success: boolean) => void): void {
    if (!this.isBrowser || this.isFetchingToken()) {
      onDone?.(false);
      return;
    }

    const chromeApi = (
      window as unknown as {
        chrome?: {
          runtime?: {
            lastError?: { message?: string };
            sendMessage: (
              extensionId: string,
              message: unknown,
              callback: (response: ExtensionFlowResponse) => void,
            ) => void;
          };
        };
      }
    ).chrome;

    if (!chromeApi?.runtime?.sendMessage) {
      this.isError.set(true);
      this.statusMessage.set('Browser extension bridge is not available.');
      onDone?.(false);
      return;
    }

    this.isFetchingToken.set(true);
    this.isError.set(false);
    this.statusMessage.set('Fetching permission token...');

    chromeApi.runtime.sendMessage(
      this.extensionId,
      {
        type: 'RUN_FULL_FLOW',
        sourcePattern: 'https://visa-admin.directksa.com/*',
        targetPattern: `${window.location.origin}/*`,
      },
      (res: ExtensionFlowResponse) => {
        this.isFetchingToken.set(false);

        if (chromeApi.runtime?.lastError) {
          this.isError.set(true);
          this.statusMessage.set(
            'Extension connection error: ' + (chromeApi.runtime.lastError.message || ''),
          );
          onDone?.(false);
          return;
        }

        if (!res?.ok || !res.token) {
          this.isError.set(true);
          this.statusMessage.set(res?.error || 'Could not retrieve token.');
          onDone?.(false);
          return;
        }

        this.setToken(res.token);
        this.isError.set(false);
        this.statusMessage.set('Token captured and stored.');
        onDone?.(true);
      },
    );
  }

  sendGetRequest(): void {
    const cleanToken = this.stripBearer(this.token());

    if (!cleanToken) {
      this.isError.set(true);
      this.statusMessage.set('No token available. Click "Get permission" first.');
      return;
    }

    const from = this.fromDate() || this.getTodayIsoDate();
    const to = this.toDate() || this.addBusinessDaysSkipFriSat(from, 3);

    this.fromDate.set(from);
    this.toDate.set(to);

    this.isError.set(false);
    this.statusMessage.set('Sending request...');

    this.apiCall.getAllReq(cleanToken, from, to).subscribe({
      next: (res) => {
        this.apiResult.set(res);
        this.isError.set(false);
        this.statusMessage.set('Request completed successfully.');
      },
      error: (err) => {
        this.isError.set(true);
        this.statusMessage.set(err?.message || 'API request failed.');
      },
    });
  }

  runFirstActionOnAllOrders(): void {
    if (this.isRunningBatch()) return;

    const cleanToken = this.stripBearer(this.token());
    if (!cleanToken) {
      this.isError.set(true);
      this.statusMessage.set('No token available. Click "Get permission" first.');
      return;
    }

    const rawResult = this.apiResult() as {
      data?: {
        data?: Array<{
          uuid?: string;
          doc_completion?: {
            whatsapp_reminder_check?: {
              is_completed?: boolean;
            };
          };
        }>;
      };
    } | null;

    const targetUuids = (rawResult?.data?.data ?? [])
      .filter((item) => item?.doc_completion?.whatsapp_reminder_check?.is_completed === false)
      .map((item) => item.uuid)
      .filter((uuid): uuid is string => Boolean(uuid));

    if (targetUuids.length === 0) {
      this.isError.set(false);
      this.statusMessage.set(
        'No applications found with whatsapp_reminder_check.is_completed = false.',
      );
      return;
    }

    this.isRunningBatch.set(true);
    this.isError.set(false);
    this.statusMessage.set(`Processing ${targetUuids.length} application(s)...`);

    forkJoin(
      targetUuids.map((uuid) =>
        this.apiCall.doneAllActionForAllOrders(cleanToken, uuid).pipe(
          map((res) => ({ uuid, ok: true as const, res })),
          catchError((err) => of({ uuid, ok: false as const, error: err })),
        ),
      ),
    ).subscribe({
      next: (results) => {
        this.isRunningBatch.set(false);
        const succeeded = results.filter((r) => r.ok).length;
        const failed = results.length - succeeded;

        if (failed === 0) {
          this.isError.set(false);
          this.statusMessage.set(`Completed action on all ${succeeded} application(s).`);
        } else {
          this.isError.set(true);
          this.statusMessage.set(
            `Completed ${succeeded} of ${results.length} application(s) (${failed} failed).`,
          );
        }
      },
      error: (err) => {
        this.isRunningBatch.set(false);
        this.isError.set(true);
        this.statusMessage.set(err?.message || 'Batch execution failed.');
      },
    });
  }

  private setToken(raw: string): void {
    this.token.set(this.stripBearer(raw));
  }

  private stripBearer(val: string): string {
    return (val || '')
      .trim()
      .replace(/^bearer\s+/i, '')
      .trim();
  }

  private getTodayIsoDate(): string {
    return this.formatIsoDate(new Date());
  }

  private addBusinessDaysSkipFriSat(startIsoDate: string, daysToAdd: number): string {
    const [year, month, day] = startIsoDate.split('-').map(Number);
    const cursor = new Date(year, month - 1, day);

    let countedDays = 0;

    while (countedDays < daysToAdd) {
      cursor.setDate(cursor.getDate() + 1);
      const dayOfWeek = cursor.getDay(); // 5 = Friday, 6 = Saturday
      if (dayOfWeek !== 5 && dayOfWeek !== 6) {
        countedDays++;
      }
    }

    return this.formatIsoDate(cursor);
  }

  private formatIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  onTrackNumberInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchTrackNumber.set(val.trim());
  }

  runAllSevenDocsForOrder(): void {
    if (this.isRunningSingleOrder()) return;

    const cleanToken = this.stripBearer(this.token());
    if (!cleanToken) {
      this.isError.set(true);
      this.statusMessage.set('No token available. Click "Get permission" first.');
      return;
    }

    const targetTrackNumber = this.searchTrackNumber().trim();
    if (!targetTrackNumber) {
      this.isError.set(true);
      this.statusMessage.set('Please enter a Track Number first.');
      return;
    }

    const rawResult = this.apiResult() as {
      data?: {
        data?: Array<{
          track_number?: string;
          uuid?: string;
          doc_completion?: Record<string, { is_completed?: boolean } | undefined>;
        }>;
      };
    } | null;

    const items = rawResult?.data?.data ?? [];
    const matchedOrder = items.find(
      (item) => String(item.track_number ?? '').trim() === targetTrackNumber,
    );

    if (!matchedOrder || !matchedOrder.uuid) {
      this.isError.set(true);
      this.statusMessage.set(
        `Track Number "${targetTrackNumber}" was not found in the loaded list.`,
      );
      return;
    }

    const docCompletion = matchedOrder.doc_completion ?? {};
    const allOrderDocKeys = Array.from(
      new Set([...this.documentKeys, ...Object.keys(docCompletion)]),
    );

    const pendingDocKeys = allOrderDocKeys.filter(
      (docKey) => docCompletion[docKey]?.is_completed !== true,
    );

    const orderUuid = matchedOrder.uuid;
    const keysToExecute = pendingDocKeys.length > 0 ? pendingDocKeys : [allOrderDocKeys[0]];

    this.isRunningSingleOrder.set(true);
    this.isError.set(false);
    this.statusMessage.set(
      pendingDocKeys.length > 0
        ? `Sending ${keysToExecute.length} pending document action(s) sequentially for Track #${targetTrackNumber}...`
        : `All documents already marked true; sending final check confirmation for Track #${targetTrackNumber}...`,
    );

    from(keysToExecute)
      .pipe(
        concatMap((docKey, index) => {
          this.statusMessage.set(
            `Track #${targetTrackNumber}: processing ${index + 1}/${keysToExecute.length} (${docKey})...`,
          );
          return this.apiCall.doneAllActionForRequest(cleanToken, docKey, orderUuid).pipe(
            map((res) => ({ docKey, ok: true as const, res })),
            catchError((err) => of({ docKey, ok: false as const, error: err })),
          );
        }),
        toArray(),
        switchMap((results) => {
          const allSucceeded = results.every((r) => r.ok);
          const isFullyChecked = results.some(
            (r) =>
              r.ok &&
              (r.res as { data?: { request_fully_checked?: boolean } })?.data
                ?.request_fully_checked === true,
          );

          if (allSucceeded && !isFullyChecked && keysToExecute.length > 0) {
            const confirmDocKey = keysToExecute[0];
            return this.apiCall.doneAllActionForRequest(cleanToken, confirmDocKey, orderUuid).pipe(
              map((res) => [...results, { docKey: confirmDocKey, ok: true as const, res }]),
              catchError((err) =>
                of([...results, { docKey: confirmDocKey, ok: false as const, error: err }]),
              ),
            );
          }

          return of(results);
        }),
      )
      .subscribe({
        next: (results) => {
          this.isRunningSingleOrder.set(false);
          const succeeded = results.filter((r) => r.ok).length;
          const failed = results.length - succeeded;

          if (failed === 0) {
            this.isError.set(false);
            this.statusMessage.set(
              `Completed ${succeeded} document action(s) for Track #${targetTrackNumber}. Refreshing list...`,
            );
            this.sendGetRequest();
          } else {
            this.isError.set(true);
            this.statusMessage.set(
              `Track #${targetTrackNumber}: ${succeeded} of ${results.length} succeeded (${failed} failed).`,
            );
          }
        },
        error: (err) => {
          this.isRunningSingleOrder.set(false);
          this.isError.set(true);
          this.statusMessage.set(err?.message || 'Failed to execute document actions.');
        },
      });
  }

  onEmployeeCountChange(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(val) || val < 1) {
      this.employeeCount.set(1);
      return;
    }
    this.employeeCount.set(Math.floor(val));
  }

  distributeRequestsFromApi(): void {
    if (this.isDistributing()) return;

    const cleanToken = this.stripBearer(this.token());
    if (!cleanToken) {
      this.isError.set(true);
      this.statusMessage.set('No token available. Click "Get permission" first.');
      return;
    }

    const from = this.fromDate() || this.getTodayIsoDate();
    const to = this.toDate() || this.addBusinessDaysSkipFriSat(from, 3);
    this.fromDate.set(from);
    this.toDate.set(to);

    const empCount = Math.max(1, Math.floor(this.employeeCount() || 1));

    this.isDistributing.set(true);
    this.isError.set(false);
    this.statusMessage.set('Fetching requests and distributing...');

    this.apiCall.getAllReq(cleanToken, from, to).subscribe({
      next: (res) => {
        this.isDistributing.set(false);
        this.apiResult.set(res);

        const rawItems =
          (
            res as {
              data?: {
                data?: Array<{
                  track_number?: string;
                  applicants_count?: number;
                  visa?: { name_en?: string };
                  country?: { name_en?: string };
                }>;
              };
            }
          )?.data?.data ?? [];

        const normalized = rawItems
          .map((item, idx) => {
            const trackNumber = String(item.track_number ?? '').trim();
            const visaNameEn = String(item.visa?.name_en ?? item.country?.name_en ?? '').trim();
            const applicantsCount = Math.max(1, Number(item.applicants_count ?? 1) || 1);
            return {
              trackNumber,
              visaNameEn,
              applicantsCount,
              bgColor: this.getApplicantBgColor(applicantsCount),
              priority: this.getCountryPriority(visaNameEn),
              originalIndex: idx,
            };
          })
          .filter((x) => Boolean(x.trackNumber))
          .sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return a.originalIndex - b.originalIndex;
          });

        const totalApplicants = normalized.reduce((sum, item) => sum + item.applicantsCount, 0);
        const baseShare = Math.floor(totalApplicants / empCount);
        const remainder = totalApplicants % empCount;

        // الطرح من آخر شخص ثم الذي قبله: الموظفون الأولون يأخذون baseShare + (i < remainder ? 1 : 0)
        // وعند وجود فائض أو طلب لا يسع بالكامل، نضبط الحدود بحيث لا يتجاوز الموظفون الأخيرون حصتهم
        const columns: EmployeeColumn[] = Array.from({ length: empCount }, (_, i) => ({
          index: i,
          name: `Employee ${i + 1}`,
          items: [],
          totalApplicants: 0,
          targetApplicants: baseShare + (i < remainder ? 1 : 0),
        }));

        let currentEmpIdx = 0;

        for (const item of normalized) {
          while (
            currentEmpIdx < empCount - 1 &&
            columns[currentEmpIdx].totalApplicants >= columns[currentEmpIdx].targetApplicants &&
            columns[currentEmpIdx].totalApplicants + item.applicantsCount >
              columns[currentEmpIdx].targetApplicants
          ) {
            currentEmpIdx++;
          }

          const targetCol = columns[Math.min(currentEmpIdx, empCount - 1)];
          targetCol.items.push({
            trackNumber: item.trackNumber,
            visaNameEn: item.visaNameEn,
            applicantsCount: item.applicantsCount,
            bgColor: item.bgColor,
          });
          targetCol.totalApplicants += item.applicantsCount;
        }

        this.distributionColumns.set(columns);
        this.isDistributionModalOpen.set(true);
        this.isError.set(false);
        this.statusMessage.set(
          `Distributed ${normalized.length} order(s) (${totalApplicants} applicants) across ${empCount} employee(s).`,
        );
      },
      error: (err) => {
        this.isDistributing.set(false);
        this.isError.set(true);
        this.statusMessage.set(err?.message || 'Failed to fetch requests for distribution.');
      },
    });
  }

  private getCountryPriority(visaNameEn: string): number {
    const normalized = visaNameEn.trim().toLowerCase();
    const idx = this.countryPriorityOrder.indexOf(normalized);
    return idx === -1 ? this.countryPriorityOrder.length : idx;
  }

  private getApplicantBgColor(count: number): string {
    if (count <= 1) return '#ffffff';
    if (count === 2) return '#f4cccc';
    if (count === 3) return '#ffff00';
    if (count === 4) return '#00ff00';
    return '#00ffff';
  }

  async copyColumnToClipboard(col: EmployeeColumn): Promise<void> {
    if (!this.isBrowser) return;

    const plainText = col.items.map((item) => item.trackNumber).join('\n');
    const htmlRows = col.items
      .map(
        (item) =>
          `<tr><td style="background-color:${item.bgColor};mso-background-color:${item.bgColor};">${item.trackNumber}</td></tr>`,
      )
      .join('');
    const htmlFragment = `<table><tbody>${htmlRows}</tbody></table>`;

    try {
      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        const item = new ClipboardItem({
          'text/html': new Blob([htmlFragment], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(plainText);
      }

      this.copiedColumnIndex.set(col.index);
      setTimeout(() => {
        if (this.copiedColumnIndex() === col.index) {
          this.copiedColumnIndex.set(null);
        }
      }, 1500);
    } catch {
      // Fallback في حال رفض المتصفح الكتابة بصيغة HTML
      const textarea = document.createElement('textarea');
      textarea.value = plainText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      this.copiedColumnIndex.set(col.index);
    }
  }

  closeDistributionModal(): void {
    this.isDistributionModalOpen.set(false);
  }
}
