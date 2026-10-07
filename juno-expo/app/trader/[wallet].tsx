import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import styled from "styled-components/native";

import { CreatorProfile } from "../../components/CreatorProfile";
import { Button, ChevronLeft, Placeholder } from "../../components/kit";
import { sameAddress, toAddress } from "../../lib/address";
import { useWallet } from "../../lib/wallet";

/**
 * Someone's profile, as anyone sees it: who they are, what they launched as a
 * grid of posts and reels, the coins they made, and what they back, with
 * their record from the leaderboard.
 *
 * Every launch opens its coin, and Buy on the header opens a buy of their
 * biggest coin at *your* size against the live curve. Copying is that and no
 * more: it does not mirror their future trades, which would need spending
 * authority this project does not ask for.
 *
 * Your own wallet here is your profile as you see it (Edit profile), without
 * the wallet tab, which lives on the Profile tab.
 */
export default function TraderScreen() {
  const { wallet: param } = useLocalSearchParams<{ wallet: string }>();
  const router = useRouter();
  const me = useWallet();

  // A malformed address owns nothing and has no page. Checked before any read,
  // so a bad link gets a way out rather than a "Try again" that cannot work.
  // A lower-cased one is fine: it is the same account, and is normalised to
  // the checksummed form every server row is keyed by.
  const target = toAddress(param);

  if (!target) {
    return (
      <Page edges={["top"]}>
        <Nav>
          <Back onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <ChevronLeft />
          </Back>
        </Nav>
        <Placeholder
          title="No such wallet"
          detail="That is not a Monad address. The link may be cut short."
          action={<Button label="Back to the feed" onPress={() => router.replace("/(tabs)/social" as never)} />}
        />
      </Page>
    );
  }

  return (
    <Page edges={["top"]}>
      <CreatorProfile
        wallet={target}
        own={sameAddress(me.address, target)}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/social" as never))}
      />
    </Page>
  );
}

const Page = styled(SafeAreaView)`
  flex: 1;
  background-color: ${(p) => p.theme.colors.bg};
`;

const Nav = styled.View`
  flex-direction: row;
  align-items: center;
  padding-horizontal: ${(p) => p.theme.space(4)}px;
  padding-bottom: ${(p) => p.theme.space(2)}px;
`;

const Back = styled.Pressable`
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background-color: ${(p) => p.theme.colors.surface};
  align-items: center;
  justify-content: center;
`;
