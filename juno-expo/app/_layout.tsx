import "../lib/polyfills";

import { Stack } from "expo-router";
import { useEffect } from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "styled-components/native";

import { LeftRail, RAILS_MIN_WIDTH, RightRail } from "../components/DesktopRails";
import { PortalHost } from "../components/Portal";
import { juno } from "../lib/api";
import { PrivyBridge } from "../lib/privy";
import { WalletRoot } from "../lib/wallet-choice";
import { theme } from "../theme";

/**
 * The app shell.
 *
 * Light throughout and pinned there: `userInterfaceStyle` is "light" in
 * app.json, so a phone in dark mode does not get a half-inverted version of a
 * palette that was validated against a light surface.
 *
 * `GestureHandlerRootView` has to be the outermost view, not a wrapper further
 * down: native gesture recognizers are attached relative to it, and a detector
 * mounted outside its subtree silently never fires.
 */
export default function RootLayout() {
  // Which network, which explorer, which quote tokens — read once, early, so
  // the first explorer link and the first balance already know the answer.
  // A failure is not kept; the next screen that needs it asks again.
  useEffect(() => {
    juno.config().catch(() => undefined);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <PhoneFrame>
    <ThemeProvider theme={theme}>
      <SafeAreaProvider>
        {/* Privy (web): email, Google or X sign-in and an embedded wallet.
            WalletRoot picks the signer — the device key or Privy's. */}
        <PrivyBridge>
        <WalletRoot>
        <PortalHost>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.bg },
              animation: "slide_from_right",
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="coin/[token]" />
            <Stack.Screen name="trader/[wallet]" />
            <Stack.Screen name="post/[id]" />
            <Stack.Screen name="inbox" />
            <Stack.Screen name="search" />
          </Stack>
        </PortalHost>
        </WalletRoot>
        </PrivyBridge>
      </SafeAreaProvider>
    </ThemeProvider>
    </PhoneFrame>
    </GestureHandlerRootView>
  );
}

/**
 * On web, the app is a phone-width column in the middle of the window.
 *
 * Juno is a phone app. Opened on a laptop, react-native-web stretched every
 * screen to 1500px: a feed image the size of the monitor and a tab bar with
 * five icons a hand-span apart. A judge's first look is usually a laptop, so
 * the web build keeps the proportions the app was designed at — 480pt at most,
 * centred on the canvas colour, full width on an actual phone. Native builds
 * are untouched.
 *
 * A window wide enough for more gets the market beside the column
 * (`DesktopRails`): Monad live on the left, what is moving on the right.
 */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  if (Platform.OS !== "web") return <>{children}</>;
  const rails = width >= RAILS_MIN_WIDTH;
  return (
    <View style={{ flex: 1, flexDirection: "row", justifyContent: "center", gap: 28, backgroundColor: "#C9D6C1" }}>
      {rails ? (
        <ThemeProvider theme={theme}>
          <LeftRail />
        </ThemeProvider>
      ) : null}
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 480,
          overflow: "hidden",
          backgroundColor: theme.colors.bg,
          boxShadow: "0 0 40px rgba(18,21,14,0.12)",
        }}
      >
        {children}
      </View>
      {rails ? (
        <ThemeProvider theme={theme}>
          <RightRail />
        </ThemeProvider>
      ) : null}
    </View>
  );
}
