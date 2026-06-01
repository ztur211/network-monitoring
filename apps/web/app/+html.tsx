import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Web-only root HTML shell used during Expo's static export (`web.output:
 * "static"`). Runs in Node during static rendering — no DOM/browser APIs here.
 *
 * Why this exists: with the Metro static export, `app.json` → `web.name` only
 * populates the PWA manifest, NOT the document `<title>`. Without a custom shell
 * every exported page has an empty/untitled tab. This sets the title + meta so
 * the browser tab reads "NodeScope" and the page is identifiable. The body-scroll
 * reset (ScrollViewStyleReset) and viewport meta match Expo's default shell, so
 * rendering behavior is unchanged.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <title>NodeScope</title>
        <meta
          name="description"
          content="NodeScope — browser-based network mapping & management platform."
        />
        {/* Disable body scrolling on web so ScrollView behaves like native. */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
