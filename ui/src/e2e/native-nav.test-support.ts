import type { Page } from "playwright";

export async function installNativeEmbed(
  page: Page,
  host: { platform: "ios" | "macos" | "android"; formFactor: "phone" | "pad" | "desktop" },
): Promise<void> {
  await page.addInitScript((embed) => {
    Object.assign(window, { __CARAPACE_NATIVE_EMBED__: embed });
  }, host);
}

// Mirror the native app's document-start flags and document-end chrome styling.
export async function installNativeWebChrome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const nativeWindow = window as Window & {
      __CARAPACE_NATIVE_WEB_CHROME__?: boolean;
      __CARAPACE_NATIVE_HISTORY__?: { canGoBack: boolean; canGoForward: boolean };
    };
    nativeWindow["__CARAPACE_NATIVE_WEB_CHROME__"] = true;
    nativeWindow["__CARAPACE_NATIVE_HISTORY__"] = {
      canGoBack: false,
      canGoForward: false,
    };
    const stamp = () => {
      document.documentElement.classList.add("carapace-native-macos", "carapace-native-web-chrome");
      document.documentElement.style.setProperty("--carapace-native-titlebar-height", "52px");
    };
    if (document.documentElement) {
      stamp();
    } else {
      document.addEventListener("DOMContentLoaded", stamp);
    }
  });
}
