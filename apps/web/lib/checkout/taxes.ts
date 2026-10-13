import "server-only";
import {
  ApiError,
  fromDatabaseError,
  type StudioSummary,
  type StudioTaxesResponse,
  TAX_CONFLICTS,
} from "@daybell/api";
import { canManagePayouts, type PstProvince, type TaxRegistrationKind } from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "../api";

/**
 * Settings › Taxes (ADR 0023; Seenu's answer 2; calls 3, 5, 6): the business address's province (the address itself
 * goes to Stripe only) and the active GST/HST and PST registrations, read through row-level security (owners and
 * admins); only the owner changes them, Stripe first, then the database (the set_payout_schedule pattern).
 */

interface DbRegistration {
  id: string;
  kind: TaxRegistrationKind;
  province: PstProvince | null;
  number: string;
  created_at: string;
}

export async function loadStudioTaxes(
  supabase: SupabaseClient,
  studio: StudioSummary,
): Promise<StudioTaxesResponse> {
  const settings = check(
    await supabase
      .from("studio_tax_settings")
      .select("head_office_province, head_office_set_at")
      .eq("studio_id", studio.id)
      .maybeSingle(),
  ) as { head_office_province: string; head_office_set_at: string } | null;
  const registrations = (check(
    await supabase
      .from("studio_tax_registrations")
      .select("id, kind, province, number, created_at")
      .eq("studio_id", studio.id)
      .is("ended_at", null)
      .order("created_at"),
  ) ?? []) as DbRegistration[];
  return {
    headOffice: settings
      ? {
          province: settings.head_office_province,
          setAt: new Date(settings.head_office_set_at).toISOString(),
        }
      : null,
    registrations: registrations.map((r) => ({
      id: r.id,
      kind: r.kind,
      province: r.province,
      number: r.number,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    collectsTax: settings !== null && registrations.length > 0,
    canManage: canManagePayouts(studio.role),
  };
}

/** Taxes are the owner's, like payouts (call 6). The database checks it again. */
export function assertCanManageTaxes(studio: StudioSummary): void {
  if (!canManagePayouts(studio.role)) throw new ApiError("forbidden", "The studio owner only.");
}

const conflict = (message: string, form: string) => new ApiError("conflict", message, { form });

export const TAXES_NOT_CONNECTED = () =>
  conflict("Set up payouts before taxes.", TAX_CONFLICTS.notConnected);
export const HEAD_OFFICE_REQUIRED = () =>
  conflict("Add your business address first.", TAX_CONFLICTS.headOfficeRequired);
export const ALREADY_REGISTERED = () =>
  conflict("That registration is already added.", TAX_CONFLICTS.alreadyRegistered);

/** The tax functions' named refusals (no values in them), as API errors. */
export function taxResult<T>(result: {
  data: unknown;
  error: { code?: string; message?: string } | null;
}): T {
  const error = result.error;
  if (!error) return result.data as T;
  if (error.code === "P0001" && error.message === "head_office_required")
    throw HEAD_OFFICE_REQUIRED();
  if (error.code === "P0001" && error.message === "already_registered") throw ALREADY_REGISTERED();
  if (error.code === "P0002") throw new ApiError("not_found", "Registration not found.");
  throw fromDatabaseError(error);
}
