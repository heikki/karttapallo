import { css } from 'lit';

export const styles = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
  :host {
    display: block;
    -webkit-user-select: none;
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .wrapper {
    background: var(--panel-surface);
    padding: 15px;
    border-radius: var(--panel-radius);
    box-shadow: var(--panel-shadow);
  }
  h2 {
    font-size: 16px;
    margin: 0 0 10px 0;
    color: var(--panel-text);
  }
  p {
    font-size: 13px;
    color: var(--panel-text-dim);
    margin: 4px 0;
  }
  .panel-header {
    cursor: pointer;
    user-select: none;
  }
  .panel-body {
    margin-top: 12px;
    border-top: 1px solid var(--panel-raised);
    padding-top: 12px;
  }
  label {
    font-size: 12px;
    color: var(--panel-text-dim);
    display: block;
    margin-bottom: 4px;
  }
  select {
    width: 100%;
    padding: 6px 8px;
    background: var(--panel-raised);
    color: var(--panel-text);
    border: 1px solid var(--panel-line);
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    margin-bottom: 8px;
  }
  .map-type-buttons,
  .filter-buttons {
    display: flex;
    gap: 0;
    margin-bottom: 8px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--panel-line);
  }
  .map-type-btn,
  .filter-btn {
    flex: 1;
    padding: 5px 0;
    border: none;
    border-right: 1px solid var(--panel-line);
    background: var(--panel-raised);
    color: var(--panel-text-dim);
    font-size: 11px;
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .map-type-btn:last-child,
  .filter-btn:last-child {
    border-right: none;
  }
  .map-type-btn:hover,
  .filter-btn:hover {
    background: var(--panel-line);
  }
  .map-type-btn.active {
    background: var(--panel-accent);
    color: white;
  }
  .filter-btn.active {
    background: var(--btn-color, var(--panel-accent));
    color: white;
  }
  .view-buttons {
    display: flex;
    gap: 6px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--panel-raised);
  }
  .view-btn {
    flex: 1;
    padding: 5px 10px;
    border: 1px solid var(--panel-line);
    border-radius: 6px;
    background: var(--panel-raised);
    color: var(--panel-text);
    font-size: 12px;
    cursor: pointer;
  }
  .view-btn:hover {
    background: var(--panel-line);
    border-color: var(--panel-line);
  }
  .view-btn:disabled {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
  }
  .view-btn.active {
    background: var(--panel-accent);
    color: white;
    border-color: var(--panel-accent);
  }
  .edit-section {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--panel-raised);
    font-size: 13px;
    color: var(--panel-text);
  }
  .count {
    font-weight: bold;
    color: #f59e0b;
  }
  .edit-buttons {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .edit-buttons button {
    flex: 1;
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    background: var(--panel-accent);
    color: white;
  }
  .edit-buttons button:hover {
    opacity: 0.9;
  }
  .edit-buttons button.secondary {
    background: var(--panel-raised);
    color: var(--panel-text);
  }
  .edit-buttons button.secondary:hover {
    background: var(--panel-line);
  }
  .edit-buttons button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
