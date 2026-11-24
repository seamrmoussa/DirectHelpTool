import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RequestActions } from './features/request-actions/request-actions';

@Component({
  imports: [RequestActions],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('DirectHelpTool');
}
