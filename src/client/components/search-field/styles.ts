import { css } from 'lit';

export const styles = css`
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
  :host {
    display: block;
    position: relative;
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  label {
    font-size: 12px;
    color: #98989d;
    display: block;
    margin-bottom: 4px;
  }
  input {
    width: 100%;
    padding: 6px 8px;
    background: #3a3a3c;
    color: #e5e5e7;
    border: 1px solid #48484a;
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 8px;
  }
  input::placeholder {
    color: #6a6a6e;
  }
  input:focus {
    outline: none;
    border-color: #007aff;
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  .token {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    margin-bottom: 8px;
    background: #007aff;
    border-radius: 6px;
    font-size: 13px;
    color: white;
  }
  .token .term {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .clear {
    border: none;
    background: transparent;
    color: white;
    font-size: 15px;
    line-height: 1;
    padding: 0 2px;
    cursor: pointer;
    opacity: 0.8;
  }
  .clear:hover {
    opacity: 1;
  }
  .suggestions {
    list-style: none;
    margin: -4px 0 8px 0;
    padding: 4px 0;
    background: #3a3a3c;
    border: 1px solid #48484a;
    border-radius: 6px;
    max-height: 220px;
    overflow-y: auto;
  }
  .group {
    font-size: 11px;
    color: #98989d;
    padding: 4px 8px 2px 8px;
  }
  .suggestion {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    font-size: 13px;
    color: #e5e5e7;
    cursor: pointer;
  }
  .suggestion .term {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .suggestion .count {
    font-size: 11px;
    color: #98989d;
  }
  .suggestion.active {
    background: #007aff;
    color: white;
  }
  .suggestion.active .count {
    color: rgba(255, 255, 255, 0.75);
  }
  .empty {
    font-size: 12px;
    color: #98989d;
    margin: 0;
    padding: 4px 8px;
  }
`;
