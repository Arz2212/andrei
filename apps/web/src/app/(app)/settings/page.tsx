import {
  getAssistantSettings,
  getOwnerProfile,
  listAssistantAgreements,
} from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";
import { SettingsView } from "@/components/modules/settings-view";

export default async function SettingsPage() {
  const { db } = await requireOwnerSession();
  const [profile, assistantSettings, agreements] = await Promise.all([
    getOwnerProfile(db),
    getAssistantSettings(db),
    listAssistantAgreements(db, false),
  ]);

  return (
    <SettingsView
      profile={profile}
      assistantSettings={assistantSettings}
      agreements={agreements}
    />
  );
}
