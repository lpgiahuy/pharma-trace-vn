import { Prisma } from "@prisma/client";

export const AVAILABLE_BOX_STATUSES = [
  "IN_STOCK",
  "MANUFACTURED",
];

/** Unreserved boxes of a medicine at a facility that box_sellable() allows today, in FEFO order. */
export async function findSellableBoxUids(
  tx: Prisma.TransactionClient,
  facilityId: number | null,
  medicineId: number,
  limit: number,
  excludeUids: string[] = [],
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ uid: string }[]>`
    SELECT b.uid::text AS uid
    FROM public.medicine_boxes b JOIN public.batches batch ON batch.id = b.batch_id
    WHERE b.current_facility_id = ${facilityId}
      AND b.status = ANY(${AVAILABLE_BOX_STATUSES}::text[])
      AND batch.medicine_id = ${medicineId}
      AND NOT (b.uid::text = ANY(${excludeUids}::text[]))
      AND public.box_sellable(b.uid, current_date)
    ORDER BY batch.expiry_date, b.created_at
    LIMIT ${limit}`;
  return rows.map((row) => row.uid);
}

/** The given boxes that box_sellable() rejects today. */
export async function findUnsellableUids(tx: Prisma.TransactionClient, uids: string[]): Promise<string[]> {
  if (uids.length === 0) return [];
  const rows = await tx.$queryRaw<{ uid: string }[]>`
    SELECT uid::text AS uid FROM unnest(${uids}::uuid[]) uid WHERE NOT public.box_sellable(uid, current_date)`;
  return rows.map((row) => row.uid);
}

export function isBoxUnit(unitName?: string | null): boolean {
  if (!unitName) return true;
  const s = unitName.trim().toUpperCase();
  const knownKeywords = [
    "BOX",
    "BLISTER",
    "BOTTLE",
    "VIAL",
    "TUBE",
    "PACK",
    "SACHET",
    "AMPOULE",
    "PILL",
    "TABLET",
    "CAPSULE",
  ];
  return knownKeywords.some((kw) => s.includes(kw));
}

