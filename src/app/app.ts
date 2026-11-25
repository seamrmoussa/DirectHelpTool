import { Component, signal } from '@angular/core';
import { RequestActions } from './features/request-actions/request-actions';
import { Navbar } from './layout/navbar/navbar';
import { Footer } from './layout/footer/footer';

@Component({
  imports: [RequestActions, Navbar, Footer],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('DirectHelpTool');
}
