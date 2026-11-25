import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ApiCalling {
  private readonly http = inject(HttpClient);

  getAllReq(token: string, fromDate = '2026-11-30', toDate = '2026-11-30'): Observable<object> {
    const headers = new HttpHeaders({
      Authorization: `Bearer ${token}`,
    });
    const params = new HttpParams()
      .set('page', '1')
      .set('per_page', '250')
      .set('queue', 'doc-check-upcoming')
      .set('appointment_from', fromDate)
      .set('appointment_to', toDate)
      .set('_locale', 'en')
      .set('_currency', 'SAR');
    return this.http.get('/api/v1/admin/applications', { headers, params });
  }

  doneAllActionForAllOrders(token: string, uuid: string): Observable<any> {
    const headers = new HttpHeaders({
      Authorization: `Bearer ${token}`,
    });
    return this.http.post(
      `/api/v1/admin/applications/${uuid}/document-completion-entries`,
      {
        choice_id: 7,
        document_key: 'whatsapp_reminder_check',
        _locale: 'en',
        _currency: 'SAR',
      },
      {
        headers,
      },
    );
  }

  doneAllActionForRequest(token: string, docKeyValue: string, uuid: string): Observable<any> {
    const headers = new HttpHeaders({
      Authorization: `Bearer ${token}`,
    });
    return this.http.post(
      `/api/v1/admin/applications/${uuid}/document-completion-entries`,
      {
        choice_id: 7,
        document_key: docKeyValue,
        _locale: 'en',
        _currency: 'SAR',
      },
      {
        headers,
      },
    );
  }
}
