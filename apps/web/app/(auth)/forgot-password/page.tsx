import { availableRegions } from "@daybell/config";
import { ForgotForm } from "./forgot-form";

export default function ForgotPasswordPage() {
  return <ForgotForm regions={availableRegions().map((r) => r.region)} />;
}
