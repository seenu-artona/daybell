import { shopUrl } from "@daybell/config";
import { ShopSettings } from "./shop-settings";

/**
 * Settings › Shop (D157; Seenu's answers B3a–B3e, Oct 14): read-only facts for everyone on the team. The shop's one
 * address comes from the deployment's configuration (SHOP_URL, else this deployment's /shop, as the QR cards print it;
 * ADR 0022), so it is read here on the server and handed to the cards.
 */
// Read at request time, never baked in at build: the address follows the deployment's own configuration.
export const dynamic = "force-dynamic";

export default function ShopSettingsPage() {
  return <ShopSettings address={shopUrl()} />;
}
