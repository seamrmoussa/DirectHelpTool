import { Component, OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ApiCalling } from '../../api-calling';
import { catchError, forkJoin, map, of } from 'rxjs';

interface ExtensionFlowResponse {
  ok?: boolean;
  token?: string;
  error?: string;
}

@Component({
  imports: [],
  selector: 'app-request-actions',
  styleUrl: './request-actions.css',
  templateUrl: './request-actions.html',
})
export class RequestActions implements OnInit, OnDestroy {
  private readonly apiCall = inject(ApiCalling);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly extensionId = 'jmmhkombpbjgkokbdkbgkcjifohagene';
  private isAutoSyncing = false;

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
      this.autoRefreshTokenAndRequests();
    }
  };

  ngOnInit(): void {
    this.resetDatesToDefault();

    if (this.isBrowser) {
      window.addEventListener('message', this.messageHandler);
      document.addEventListener('visibilitychange', this.visibilityHandler);
      this.fetchTokenFromExtension((ok) => {
        if (ok) {
          this.sendGetRequest();
        }
      });
    }
  }

  ngOnDestroy(): void {
    if (this.isBrowser) {
      window.removeEventListener('message', this.messageHandler);
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
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
        console.log(res);
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
    const pendingDocKeys = this.documentKeys.filter(
      (docKey) => docCompletion[docKey]?.is_completed !== true,
    );

    if (pendingDocKeys.length === 0) {
      this.isError.set(false);
      this.statusMessage.set(
        `All 7 documents for Track #${targetTrackNumber} are already completed.`,
      );
      return;
    }

    const orderUuid = matchedOrder.uuid;

    this.isRunningSingleOrder.set(true);
    this.isError.set(false);
    this.statusMessage.set(
      `Sending ${pendingDocKeys.length} pending document action(s) for Track #${targetTrackNumber}...`,
    );

    forkJoin(
      pendingDocKeys.map((docKey) =>
        this.apiCall.doneAllActionForRequest(cleanToken, docKey, orderUuid).pipe(
          map((res) => ({ docKey, ok: true as const, res })),
          catchError((err) => of({ docKey, ok: false as const, error: err })),
        ),
      ),
    ).subscribe({
      next: (results) => {
        this.isRunningSingleOrder.set(false);
        const succeeded = results.filter((r) => r.ok).length;
        const failed = results.length - succeeded;

        console.log(`Track #${targetTrackNumber} (${orderUuid}) pending docs results:`, results);

        if (failed === 0) {
          this.isError.set(false);
          this.statusMessage.set(
            `Completed ${succeeded} pending document action(s) for Track #${targetTrackNumber}.`,
          );
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
}
