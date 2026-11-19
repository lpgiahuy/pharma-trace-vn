\set ON_ERROR_STOP on
BEGIN;
-- Internal transfers without an order: an order transfer always has its order, every other type never has one.
ALTER TABLE public.internal_transfers ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.internal_transfers ADD COLUMN IF NOT EXISTS transfer_type varchar(30) NOT NULL DEFAULT 'ORDER_FULFILLMENT';
ALTER TABLE public.internal_transfers ADD COLUMN IF NOT EXISTS request_id integer;
ALTER TABLE public.internal_transfers DROP CONSTRAINT IF EXISTS internal_transfers_type_check;
ALTER TABLE public.internal_transfers ADD CONSTRAINT internal_transfers_type_check CHECK (
  transfer_type IN ('ORDER_FULFILLMENT', 'REPLENISHMENT', 'RETURN_TO_WAREHOUSE', 'RECALL_COLLECTION')
  AND (transfer_type = 'ORDER_FULFILLMENT') = (order_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uq_internal_transfers_request ON public.internal_transfers(request_id);
COMMIT;
