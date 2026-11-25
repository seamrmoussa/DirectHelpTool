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

  readonly token = signal<string>('');
  readonly fromDate = signal<string>(this.getTodayIsoDate());
  readonly toDate = signal<string>(this.getTodayIsoDate());

  readonly isFetchingToken = signal<boolean>(false);
  readonly isRunningBatch = signal<boolean>(false);
  readonly statusMessage = signal<string>('');
  readonly isError = signal<boolean>(false);
  readonly apiResult = signal<unknown>(null);

  readonly searchOrderId = signal<string>('');
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

  ngOnInit(): void {
    this.fromDate.set(this.getTodayIsoDate());
    this.toDate.set(this.getTodayIsoDate());

    if (this.isBrowser) {
      window.addEventListener('message', this.messageHandler);
      this.fetchTokenFromExtension();
    }
  }

  ngOnDestroy(): void {
    if (this.isBrowser) {
      window.removeEventListener('message', this.messageHandler);
    }
  }

  onFromDateChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    if (val) this.fromDate.set(val);
  }

  onToDateChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    if (val) this.toDate.set(val);
  }

  fetchTokenFromExtension(): void {
    if (!this.isBrowser || this.isFetchingToken()) return;

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
          return;
        }

        if (!res?.ok || !res.token) {
          this.isError.set(true);
          this.statusMessage.set(res?.error || 'Could not retrieve token.');
          return;
        }

        this.setToken(res.token);
        this.isError.set(false);
        this.statusMessage.set('Token captured and stored.');
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

    this.isError.set(false);
    this.statusMessage.set('Sending request...');

    this.apiCall.getAllReq(cleanToken, this.fromDate(), this.toDate()).subscribe({
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
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  onOrderIdInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchOrderId.set(val.trim());
  }

  runAllSevenDocsForOrder(): void {
    if (this.isRunningSingleOrder()) return;

    const cleanToken = this.stripBearer(this.token());
    if (!cleanToken) {
      this.isError.set(true);
      this.statusMessage.set('No token available. Click "Get permission" first.');
      return;
    }

    const targetId = this.searchOrderId().trim();
    if (!targetId) {
      this.isError.set(true);
      this.statusMessage.set('Please enter an Application ID first.');
      return;
    }

    const rawResult = this.apiResult() as {
      data?: {
        data?: Array<{
          id?: string;
          uuid?: string;
          doc_completion?: {
            whatsapp_reminder_check?: {
              is_completed?: boolean;
            };
          };
        }>;
      };
    } | null;

    const items = rawResult?.data?.data ?? [];
    const matchedOrder = items.find((item) => String(item.id).trim() === targetId);

    if (!matchedOrder || !matchedOrder.uuid) {
      this.isError.set(true);
      this.statusMessage.set(`Order ID "${targetId}" was not found in the loaded list.`);
      return;
    }

    if (matchedOrder.doc_completion?.whatsapp_reminder_check?.is_completed !== false) {
      this.isError.set(true);
      this.statusMessage.set(
        `Order "${targetId}" skipped: whatsapp_reminder_check.is_completed is already true.`,
      );
      return;
    }

    const orderUuid = matchedOrder.uuid;

    this.isRunningSingleOrder.set(true);
    this.isError.set(false);
    this.statusMessage.set(`Sending 7 document actions for Order #${targetId}...`);

    forkJoin(
      this.documentKeys.map((docKey) =>
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

        console.log(`Order #${targetId} (${orderUuid}) 7-doc results:`, results);

        if (failed === 0) {
          this.isError.set(false);
          this.statusMessage.set(`All 7 document actions completed for Order #${targetId}.`);
        } else {
          this.isError.set(true);
          this.statusMessage.set(
            `Order #${targetId}: ${succeeded} of 7 succeeded (${failed} failed).`,
          );
        }
      },
      error: (err) => {
        this.isRunningSingleOrder.set(false);
        this.isError.set(true);
        this.statusMessage.set(err?.message || 'Failed to execute 7 document actions.');
      },
    });
  }
}
