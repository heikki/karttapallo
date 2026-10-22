# The app's server answers only its own window

The local `Bun.serve` of ADR-0005 reads the Photos library and writes edits back to it, so nothing but the app's window gets in: not another machine on the network, and not a browser on this Mac.

- **It listens on loopback only.** `hostname: '127.0.0.1'`; Bun's default is every interface. The dev and E2E servers do the same.
- **A per-launch key, traded for a cookie.** Each launch makes a random key. The window opens on `/enter?key=…&next=…`, which sets it as an HttpOnly, `SameSite=Strict` cookie and redirects to `next`, the view it was opened for (the saved view or a deep link). Every other request without that cookie gets a bare 403. The key never stays in a URL the page can write, copy or hand to the browser, and a cookie from an earlier launch no longer matches.

The dev server has no key: it's meant to be opened in a browser.

## Considered options

- **Loopback only.** Rejected on its own: any browser on the Mac, and any web page it has open, can still reach `127.0.0.1`.
- **The key in every URL, or a header.** Rejected: an `<img>`, a map tile or a navigation can't send a header, and a key in the URL would land in the URL state the map writes.

## Consequences

- Opening the app's address in a browser gets a blank page.
- `next` is only ever a path on the app's own server.
