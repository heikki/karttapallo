import './components';

// Electrobun's preload wraps these to turn a URL write made with ⌘ held (or
// just let go) into a new-window request; the map writes its view into the
// URL as it moves, so with ⌘ down those writes would be dropped. The
// prototype's own versions sit under the wrappers.
delete (history as Partial<History>).pushState;
delete (history as Partial<History>).replaceState;
