import { Component, OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

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
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // ضع هنا الـ Extension ID الظاهر تحت اسم الإضافة في chrome://extensions
  private readonly extensionId = 'jmmhkombpbjgkokbdkbgkcjifohagene';

  readonly token = signal<string>('');
  readonly statusMessage = signal<string>('');
  readonly isLoading = signal<boolean>(false);
  readonly isError = signal<boolean>(false);

  private readonly messageHandler = (event: MessageEvent) => {
    if (event.data?.type === 'EXT_TOKEN_READY' && event.data.token) {
      this.applyToken(event.data.token);
      this.isError.set(false);
      this.statusMessage.set('تم استلام التوكن من الإضافة بنجاح.');
    }
  };

  ngOnInit(): void {
    if (this.isBrowser) {
      window.addEventListener('message', this.messageHandler);
    }
  }

  ngOnDestroy(): void {
    if (this.isBrowser) {
      window.removeEventListener('message', this.messageHandler);
    }
  }

  onTokenInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.token.set(this.stripBearer(value));
  }

  fetchTokenFromExtension(): void {
    if (!this.isBrowser) return;

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
      this.statusMessage.set('الإضافة غير متصلة بالمتصفح أو غير مفعّلة.');
      return;
    }

    this.isLoading.set(true);
    this.isError.set(false);
    this.statusMessage.set('جاري الضغط على Search في صفحة النظام وسحب التوكن...');

    chromeApi.runtime.sendMessage(
      this.extensionId,
      {
        type: 'RUN_FULL_FLOW',
        sourcePattern: 'https://visa-admin.directksa.com/*',
        targetPattern: 'https://directhelptool.seamrmoussa.workers.dev/*',
      },
      (res: ExtensionFlowResponse) => {
        this.isLoading.set(false);

        if (chromeApi.runtime?.lastError) {
          this.isError.set(true);
          this.statusMessage.set(
            'خطأ اتصال بالـ Extension: ' + (chromeApi.runtime.lastError.message || ''),
          );
          return;
        }

        if (!res?.ok || !res.token) {
          this.isError.set(true);
          this.statusMessage.set(res?.error || 'تعذر سحب التوكن، تأكد أن صفحة النظام مفتوحة.');
          return;
        }

        this.applyToken(res.token);
        this.isError.set(false);
        this.statusMessage.set('تم سحب التوكن ولصقه بنجاح.');
      },
    );
  }

  private applyToken(raw: string): void {
    this.token.set(this.stripBearer(raw));
  }

  private stripBearer(val: string): string {
    return (val || '')
      .trim()
      .replace(/^bearer\s+/i, '')
      .trim();
  }
}
