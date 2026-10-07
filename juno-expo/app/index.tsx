import { useRouter } from "expo-router";
import { useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import styled from "styled-components/native";

import { OnboardingArt } from "../components/art";
import { Heartbeat } from "../components/Heartbeat";
import { Body, Button, Caption, Display } from "../components/kit";
import { juno, networkLabel } from "../lib/api";
import { useApi } from "../lib/useApi";

/**
 * Onboarding.
 *
 * One screen, one action. Get Started drops straight into the feed — it does
 * not ask for an account, because a social feed behind a login is dead on
 * arrival and the first thing anyone sees should be the product working. A
 * wallet is created later, at the moment someone actually needs one.
 */
export default function Onboarding() {
  const router = useRouter();
  // Which chain, from the server rather than compiled in: the badge said
  // "Monad testnet" on a local fork and would have said it on mainnet too.
  const config = useApi(() => juno.config(), []);
  const network = config.data?.network ?? "monad-testnet";
  const stats = useApi(() => juno.stats(), []);
  // The block number ticks while the page is open: proof the chain is live,
  // read again every couple of seconds rather than animated.
  const { refresh } = stats;
  useEffect(() => {
    const timer = setInterval(refresh, 2_500);
    return () => clearInterval(timer);
  }, [refresh]);
  const live = stats.data;

  return (
    <Page edges={["top", "bottom"]}>
      <Art>
        <OnboardingArt size={240} />
      </Art>

      {/* What it is, in the first five seconds. "Social Trading Community"
          said nothing a judge could not have guessed from any fintech app;
          this names the mechanism, the chain, and the pre-IPO half — and
          that it is testnet, so nobody mistakes test MON for money. */}
      <Copy>
        <Network>
          <Dot />
          <NetworkText>
            {networkLabel(network)}
            {network === "monad-testnet" ? " · no real money" : ""}
          </NetworkText>
        </Network>
        <Display>Every post{"\n"}is a market.</Display>
        <Body muted>
          Post a photo or a reel and it launches its own bonding curve on Monad.
          Buy into the posts you believe in — creators earn the trading fees.
          Pre-IPO names like OpenAI and SpaceX trade here too, marked against
          Tessera.
        </Body>
      </Copy>

      {/* What is happening now, read when the page asks: no figure is shown
          that was not read, and one that could not be is left out. */}
      {live ? (
        <Live accessibilityLabel="Live on Monad">
          <LiveHead>
            <Dot />
            <LiveTitle>Live on {live.localFork ? "a local fork of Monad testnet" : "Monad"}</LiveTitle>
          </LiveHead>
          <Grid>
            {live.coins !== null ? <Figure testID="stat-coins" value={String(live.coins)} label="markets live" /> : null}
            {live.trades24h !== null ? (
              <Figure
                testID="stat-trades"
                value={String(live.trades24h)}
                // Fills Juno recorded on curves and Uniswap pairs; Kuru keeps its own book.
                label={`curve & pair trades, 24h${live.traders24h ? ` · ${live.traders24h} wallets` : ""}`}
              />
            ) : null}
            {live.confirmation ? (
              <Figure
                testID="stat-confirm"
                value={`${live.confirmation.medianMs.toLocaleString("en-US")} ms`}
                label={
                  live.confirmation.samples === 1
                    ? "to confirm, the last trade"
                    : `to confirm, median of the last ${live.confirmation.samples} trades`
                }
              />
            ) : null}
            {live.block ? (
              <Figure testID="stat-block" value={`#${live.block.number.toLocaleString("en-US")}`} label="latest block" />
            ) : null}
          </Grid>
          <Heartbeat compact />
        </Live>
      ) : null}

      <Button label="Get Started" tall onPress={() => router.replace("/(tabs)/social")} />
    </Page>
  );
}

function Figure({ value, label, testID }: { value: string; label: string; testID: string }) {
  return (
    <Cell>
      <FigureValue testID={testID}>{value}</FigureValue>
      <Caption>{label}</Caption>
    </Cell>
  );
}

const Live = styled.View`
  background-color: ${(p) => p.theme.colors.surface};
  border-radius: ${(p) => p.theme.radius.lg}px;
  padding: ${(p) => p.theme.space(4)}px;
  margin-bottom: ${(p) => p.theme.space(4)}px;
  gap: ${(p) => p.theme.space(3)}px;
`;

const LiveHead = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 6px;
`;

const LiveTitle = styled.Text`
  font-size: ${(p) => p.theme.type.caption.size}px;
  font-weight: 800;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: ${(p) => p.theme.colors.muted};
`;

const Grid = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  row-gap: ${(p) => p.theme.space(3)}px;
`;

const Cell = styled.View`
  width: 50%;
  gap: 2px;
`;

const FigureValue = styled.Text`
  font-size: ${(p) => p.theme.type.title.size}px;
  font-weight: 800;
  letter-spacing: -0.4px;
  font-variant: tabular-nums;
  color: ${(p) => p.theme.colors.text};
`;

const Page = styled(SafeAreaView)`
  flex: 1;
  background-color: ${(p) => p.theme.colors.bg};
  padding-horizontal: ${(p) => p.theme.space(6)}px;
  padding-bottom: ${(p) => p.theme.space(4)}px;
`;

const Art = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const Copy = styled.View`
  gap: ${(p) => p.theme.space(3)}px;
  padding-bottom: ${(p) => p.theme.space(5)}px;
`;

const Network = styled.View`
  flex-direction: row;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  background-color: ${(p) => p.theme.colors.surface};
`;

const Dot = styled.View`
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background-color: ${(p) => p.theme.colors.pos};
`;

const NetworkText = styled.Text`
  font-size: ${(p) => p.theme.type.caption.size}px;
  font-weight: 700;
  color: ${(p) => p.theme.colors.muted};
`;
