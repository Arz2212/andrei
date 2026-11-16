import {
  formatIsoDate,
  getDailyReview,
  getOwnerProfile,
  listDailyReviews,
  listEveningCriteria,
  listStateCheckins,
} from "@life-os/db";
import { requireOwnerSession } from "@/lib/supabase/server";
import { JournalView } from "@/components/modules/journal-view";

export default async function JournalPage() {
  const { db } = await requireOwnerSession();
  const profile = await getOwnerProfile(db);
  const todayDate = formatIsoDate(new Date(), profile?.timezone ?? "Europe/Moscow");

  const [checkins, criteria, todayReview, recentReviews] = await Promise.all([
    listStateCheckins(db, 25),
    listEveningCriteria(db),
    getDailyReview(db, todayDate),
    listDailyReviews(db, 14),
  ]);

  return (
    <JournalView
      todayDate={todayDate}
      checkins={checkins}
      criteria={criteria}
      todayReview={todayReview}
      recentReviews={recentReviews}
    />
  );
}
