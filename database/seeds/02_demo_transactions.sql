-- PharmaTrace VN demo transactions (generated from the manual end-to-end test run).
-- Loaded last by 00_master_init.sql. Contains purchase orders, batches, boxes, orders, returns,
-- recalls, disposals, finance entries, reviews and a blog article for the demo accounts.
-- Personal data was replaced with placeholders. Image references point to the author's Cloudinary
-- account and may not resolve elsewhere. Development only; requires a superuser session because
-- triggers are bypassed (session_replication_role = replica) while rows are copied in.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL session_replication_role = replica;
SET LOCAL search_path = public, pg_catalog;

COPY public.accounts_payable (id, supplier_name, po_id, total_due_amount, paid_amount, due_date, status, created_at, updated_at, supplier_id, goods_receipt_id) FROM stdin;
1	PharmaTrace Factory - Binh Duong	2	50000.00	0.00	2026-12-24 10:08:23.147906+00	UNPAID	2026-11-24 10:08:23.147906+00	2026-11-24 10:08:23.147906+00	2045	1
2	Pharmatrace Factory - Binh Duong	1	50000.00	50000.00	2026-12-24 10:09:43.793796+00	PAID	2026-11-24 10:09:43.793796+00	2026-11-24 13:48:10.248425+00	\N	2
\.

COPY public.article_categories (id, name, slug) FROM stdin;
1	Thực phẩm chức năng	thuc-pham-chuc-nang
\.

COPY public.article_comments (id, article_id, parent_id, customer_id, employee_id, author_name, content, status, created_at, updated_at) FROM stdin;
1	1	\N	17	\N	Demo customer 17	Thanks for good information	VISIBLE	2026-11-24 13:08:58.239+00	2026-11-24 13:08:58.239+00
2	1	1	\N	11	Super Admin	ok	VISIBLE	2026-11-24 13:09:26.184+00	2026-11-24 13:09:26.184+00
\.

COPY public.articles (id, title, slug, summary, content, cover_image_url, author_id, view_count, status, created_at, category_id, cover_image_public_id, review_note, published_at, updated_at, author_name) FROM stdin;
1	How to...	how-to	A short guide for customers	<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>	https://res.cloudinary.com/dc64co0el/image/upload/v1795525693/pharmatrace/articles/g7worrplchvxekmr10r8.jpg	13	2	PUBLISHED	2026-11-24 13:08:17.439	\N	pharmatrace/articles/g7worrplchvxekmr10r8	\N	2026-11-24 13:08:27.687+00	2026-11-24 13:08:29.656+00	Pharmacist
\.

COPY public.batch_recall_batches (recall_id, batch_id) FROM stdin;
1	4
2	6
\.

COPY public.batch_recall_events (id, recall_id, action, facility_id, batch_id, box_uids, transfer_id, actor_id, note, created_at) FROM stdin;
1	1	CREATE	\N	\N	{}	\N	15	wrong name	2026-11-24 09:42:16.273321+00
2	1	HOLD	2045	4	{cfc8556e-74f3-403c-b910-236301381bf1,33c7d775-0a0e-46f9-b2a1-8ba64c7f2e6b,4e6daa83-de84-4943-92f2-86ddd31c0d49,7142d432-6b02-4072-9ab2-13a555dbeb5b,360dd154-8eba-4071-8170-4d031ff9ffbc}	\N	15	\N	2026-11-24 09:42:16.273321+00
3	2	CREATE	\N	\N	{}	\N	15	Quality defect found in batch	2026-11-24 13:24:26.078361+00
4	2	HOLD	2045	6	{ff0da260-c9a5-4661-b591-1216c28ea677,ff04accd-4a81-46c1-b6ed-03644420b326,3f710c3f-6cd0-4f49-beba-ddf1d7491e59,f8a00734-684c-4e89-b9fa-9bcc1b508c16,c21e0c80-05b8-482c-9428-e1a398b96d0d}	\N	15	\N	2026-11-24 13:24:26.078361+00
5	2	HOLD	2046	6	{475f6836-d23a-4fdd-8013-fb4b1573974d,bc90a554-ceb8-43cb-81cd-dd6329fe15fc,d19dd4b7-61d9-42e7-aa21-9b539f390d82,dd6366cf-0367-4a82-b99c-79b657efd92d,05b07c94-6d47-4ff8-9a88-70ea9c1e6f30}	\N	15	\N	2026-11-24 13:24:26.078361+00
6	2	COLLECT	2046	6	{475f6836-d23a-4fdd-8013-fb4b1573974d,bc90a554-ceb8-43cb-81cd-dd6329fe15fc,d19dd4b7-61d9-42e7-aa21-9b539f390d82,dd6366cf-0367-4a82-b99c-79b657efd92d,05b07c94-6d47-4ff8-9a88-70ea9c1e6f30}	6	39	\N	2026-11-24 14:33:20.180533+00
7	2	HOLD	2045	6	{475f6836-d23a-4fdd-8013-fb4b1573974d,bc90a554-ceb8-43cb-81cd-dd6329fe15fc,d19dd4b7-61d9-42e7-aa21-9b539f390d82,dd6366cf-0367-4a82-b99c-79b657efd92d,05b07c94-6d47-4ff8-9a88-70ea9c1e6f30}	6	15	\N	2026-11-24 14:37:30.427114+00
\.

COPY public.batch_recalls (id, recall_code, reason, severity, document_url, status, created_by, created_at, closed_by, closed_at) FROM stdin;
1	RCL-20261124-1XLB	wrong name	LEVEL_3	\N	ACTIVE	15	2026-11-24 09:42:16.273321+00	\N	\N
2	RCL-20261124-Q6PB	Quality defect found in batch	LEVEL_2	\N	ACTIVE	15	2026-11-24 13:24:26.078361+00	\N	\N
\.

COPY public.batch_status_events (id, batch_id, from_status, to_status, reason, actor_id, created_at) FROM stdin;
1	4	ACTIVE	RECALLED	Recall RCL-20261124-1XLB	15	2026-11-24 09:42:16.273321+00
2	2	ACTIVE	ON_HOLD	Quality hold, released after review	15	2026-11-24 09:42:36.800756+00
3	2	ON_HOLD	ACTIVE	release	15	2026-11-24 09:42:42.922763+00
4	6	ACTIVE	RECALLED	Recall RCL-20261124-Q6PB	15	2026-11-24 13:24:26.078361+00
\.

COPY public.batches (id, batch_number, medicine_id, legacy_manufacturer_facility_id, production_date, expiry_date, initial_quantity, remaining_quantity, status, certificate_co_cq, created_at, manufacturer_id, manufacturer_source_facility_name, manufacturer_source_facility_id, hold_reason, held_by_id, held_at) FROM stdin;
4	LOT-2026-1-WRONG	9	\N	2026-11-24	2028-11-24	5	5	RECALLED	\N	2026-11-24 09:40:56.250437	\N	PharmaTrace Factory - Binh Duong	2045	\N	\N	\N
3	LOT-2026-1-RX	1797	\N	2026-11-24	2028-11-24	60	59	ACTIVE	\N	2026-11-24 09:40:22.179805	\N	PharmaTrace Factory - Binh Duong	2045	\N	\N	\N
2	LOT-2026-1-NEAR-EXPIRED	9	\N	2026-11-24	2027-01-24	30	20	ACTIVE	\N	2026-11-24 09:39:01.006432	\N	PharmaTrace Factory - Binh Duong	2045	\N	\N	\N
5	LOT-2026-2-RESTOCK	9	\N	2026-11-24	2028-09-24	10	0	ACTIVE	\N	2026-11-24 10:09:43.793796	236	\N	\N	\N	\N	\N
1	LOT-A-2026-01	9	\N	2026-11-24	2028-11-24	60	54	ACTIVE	\N	2026-11-24 09:38:05.512234	\N	PharmaTrace Factory - Binh Duong	2045	\N	\N	\N
6	LOT-2026-RECALL	9	\N	2026-11-24	2026-11-30	10	0	RECALLED	\N	2026-11-24 13:20:50.404252	\N	PharmaTrace Factory - Binh Duong	2045	\N	\N	\N
\.

COPY public.box_activations (uid, activated_at, verify_count) FROM stdin;
00d3d676-808d-4e7d-90be-24fcaf4914aa	2026-11-24 13:15:14.990954+00	12
\.

COPY public.box_code_entries (id, uid, valid, device, entered_at) FROM stdin;
1	00d3d676-808d-4e7d-90be-24fcaf4914aa	t	4d7eafaf-4b25-42eb-b27f-29244a102e33	2026-11-24 13:15:14.990954+00
2	00d3d676-808d-4e7d-90be-24fcaf4914aa	t	4d7eafaf-4b25-42eb-b27f-29244a102e33	2026-11-24 13:15:27.487534+00
3	00d3d676-808d-4e7d-90be-24fcaf4914aa	t	4d7eafaf-4b25-42eb-b27f-29244a102e33	2026-11-24 13:16:13.318948+00
4	00d3d676-808d-4e7d-90be-24fcaf4914aa	t	4d7eafaf-4b25-42eb-b27f-29244a102e33	2026-11-24 13:16:19.47754+00
5	00d3d676-808d-4e7d-90be-24fcaf4914aa	t	4d7eafaf-4b25-42eb-b27f-29244a102e33	2026-11-24 13:16:24.208891+00
6	00d3d676-808d-4e7d-90be-24fcaf4914aa	t	4d7eafaf-4b25-42eb-b27f-29244a102e33	2026-11-24 13:16:29.037407+00
7	00d3d676-808d-4e7d-90be-24fcaf4914aa	t	4d7eafaf-4b25-42eb-b27f-29244a102e33	2026-11-24 13:16:33.663277+00
8	00d3d676-808d-4e7d-90be-24fcaf4914aa	t	4d7eafaf-4b25-42eb-b27f-29244a102e33	2026-11-24 13:16:37.286526+00
9	00d3d676-808d-4e7d-90be-24fcaf4914aa	t	4d7eafaf-4b25-42eb-b27f-29244a102e33	2026-11-24 13:16:40.945546+00
10	00d3d676-808d-4e7d-90be-24fcaf4914aa	t	4d7eafaf-4b25-42eb-b27f-29244a102e33	2026-11-24 13:16:44.581944+00
11	00d3d676-808d-4e7d-90be-24fcaf4914aa	t	4d7eafaf-4b25-42eb-b27f-29244a102e33	2026-11-24 13:16:49.69729+00
12	00d3d676-808d-4e7d-90be-24fcaf4914aa	t	4d7eafaf-4b25-42eb-b27f-29244a102e33	2026-11-24 13:16:56.350564+00
\.

COPY public.carrier_handover_packages (handover_id, package_id) FROM stdin;
1	3
\.

COPY public.carrier_handovers (id, handover_code, facility_id, courier_name, driver_name, driver_phone, vehicle_plate, note, handed_over_by_id, handed_over_at) FROM stdin;
1	HOV-20261124-D83D6D	2046	GHN	Nguyen Van Tai	0900000001	59A1-123.45	\N	14	2026-11-24 12:32:20.573721+00
\.

COPY public.cashbook_logs (id, transaction_code, transaction_type, category, amount, party_type, party_name, order_id, po_id, payment_method, note, transaction_date, created_by_user_id) FROM stdin;
1	COD-SHIP-2	INCOME	COD	40000.00	OTHER	GHN	1	\N	BANK_TRANSFER	Statement: COD-STMT-A38BEC4E	2026-11-24 12:39:29.327598+00	22
2	COD-SHIP-1	INCOME	COD	106818.00	OTHER	GHTK	2	\N	BANK_TRANSFER	Statement: COD-STMT-AD442170	2026-11-24 12:41:40.762979+00	22
3	REF-276dcb61-82e9-41d9-a3ce-9f703e1052ef	EXPENSE	CUSTOMER_REFUND	15000.00	CUSTOMER	\N	1	\N	CASH	RMA-261124-F342BB - refund reference: PC-20261124-001	2026-11-24 12:56:54.126581+00	12
4	SUP-1	EXPENSE	SUPPLIER_PAYMENT	50000.00	SUPPLIER	Pharmatrace Factory - Binh Duong	\N	1	BANK_TRANSFER	Payment reference: BK-20261124-001	2026-11-24 13:48:10.248425+00	22
\.

COPY public.cod_statement_reviews (id, shipment_id, gross, fee, adjustment, net, statement_reference, notes, status, recorded_by, recorded_at, approved_by, approved_at, result) FROM stdin;
1	2	50000.00	10000.00	0.00	40000.00	COD-STMT-A38BEC4E	\N	APPROVED	21	2026-11-24 12:37:50.461419+00	22	2026-11-24 12:39:29.327598+00	{"status": "SETTLED", "netAmount": 40000.00, "cashbookId": 1, "shipmentId": 2, "discrepancyAmount": 0.00, "discrepancyStatus": "NONE"}
2	1	136818.00	30000.00	0.00	106818.00	COD-STMT-AD442170	\N	APPROVED	21	2026-11-24 12:41:23.498535+00	22	2026-11-24 12:41:40.762979+00	{"status": "SETTLED", "netAmount": 106818.00, "cashbookId": 2, "shipmentId": 1, "discrepancyAmount": 0.00, "discrepancyStatus": "NONE"}
\.

COPY public.courier_receivables (shipment_id, courier_name, amount_due, collected_amount, status, created_at, settled_at) FROM stdin;
2	GHN	50000.00	50000.00	SETTLED	2026-11-24 12:13:21.078346+00	2026-11-24 12:39:29.327598+00
1	GHTK	136818.00	136818.00	SETTLED	2026-11-24 12:11:18.090524+00	2026-11-24 12:41:40.762979+00
\.

COPY public.courier_service_fees (shipment_id, amount, statement_reference, recorded_by, created_at) FROM stdin;
2	10000.00	COD-STMT-A38BEC4E	22	2026-11-24 12:39:29.327598+00
1	30000.00	COD-STMT-AD442170	22	2026-11-24 12:41:40.762979+00
\.

COPY public.disposal_attachments (id, disposal_id, image_reference, uploaded_by_id, created_at) FROM stdin;
1	1	pharmatrace/disposals/jl61xcbdxtlo4r9fczo6	15	2026-11-24 14:40:02.011116+00
\.

COPY public.disposal_events (id, disposal_id, action, from_status, to_status, actor_id, note, created_at) FROM stdin;
1	1	CREATED	\N	DRAFT	15	Recalled batch disposed after collection	2026-11-24 14:39:45.151291+00
2	1	ATTACHMENT_ADDED	DRAFT	DRAFT	15	\N	2026-11-24 14:40:02.011116+00
4	1	APPROVED	DRAFT	APPROVED	15	\N	2026-11-24 14:54:38.584862+00
5	1	COMPLETED	APPROVED	COMPLETED	15	\N	2026-11-24 14:54:40.83109+00
\.

COPY public.disposal_items (id, disposal_id, box_uid, batch_id, source) FROM stdin;
1	1	05b07c94-6d47-4ff8-9a88-70ea9c1e6f30	6	RECALL
2	1	3f710c3f-6cd0-4f49-beba-ddf1d7491e59	6	RECALL
3	1	475f6836-d23a-4fdd-8013-fb4b1573974d	6	RECALL
4	1	bc90a554-ceb8-43cb-81cd-dd6329fe15fc	6	RECALL
5	1	c21e0c80-05b8-482c-9428-e1a398b96d0d	6	RECALL
6	1	d19dd4b7-61d9-42e7-aa21-9b539f390d82	6	RECALL
7	1	dd6366cf-0367-4a82-b99c-79b657efd92d	6	RECALL
8	1	f8a00734-684c-4e89-b9fa-9bcc1b508c16	6	RECALL
9	1	ff04accd-4a81-46c1-b6ed-03644420b326	6	RECALL
10	1	ff0da260-c9a5-4661-b591-1216c28ea677	6	RECALL
\.

COPY public.disposals (id, disposal_code, facility_id, status, reason, created_by_id, created_at, approved_by_id, approved_at, completed_by_id, completed_at) FROM stdin;
1	DSP-20261124-07B8EC	2045	COMPLETED	Recalled batch disposed after collection	15	2026-11-24 14:39:45.151291+00	15	2026-11-24 14:54:38.584862+00	15	2026-11-24 14:54:40.83109+00
\.

COPY public.fraud_alerts (id, uid, fraud_type, severity_level, description, latitude_1, longitude_1, latitude_2, longitude_2, distance_km, time_delta_minutes, calculated_speed_kmh, resolution_status, created_at, facility_id, scanned_code, reported_by_id, resolved_by_id, resolved_at, resolution_note) FROM stdin;
1	00d3d676-808d-4e7d-90be-24fcaf4914aa	CODE_BURST	CRITICAL	The secret code was entered 10 times within a minute	\N	\N	\N	\N	\N	\N	\N	UNRESOLVED	2026-11-24 13:16:56.350564	\N	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	\N	\N	\N
\.

COPY public.goods_receipt_lines (id, receipt_id, po_item_id, batch_id, quantity_accepted, quantity_rejected, reject_reason, box_uids, rejected_box_uids) FROM stdin;
1	1	2	2	10	0	\N	{08522e76-26fe-4605-b8b5-c11fbb3be573,0da596b3-c5b5-409f-96a4-f999a90b8774,1df14bd6-e9c3-431d-90c5-bf702f343d55,7cb84802-3826-423e-a026-4e74bf4e0de3,85a39f1e-2190-4192-9cbc-faba709adf30,9453bbdc-4dc7-44a3-9acf-c3edfbb95306,a82b0fd8-c05f-4972-8a14-89d04062ee21,b3c378a8-848c-45ef-b0ef-c7c2526789b4,b651621c-14a1-4b7f-8e9e-173fb64e3158,d060090a-db1d-43f7-bca0-e32fa89b8900}	{}
2	2	1	5	10	0	\N	{f108ff76-ff55-4a62-b59f-b11bd3bc9d2f,5e73dcdc-5d4e-46cc-b21c-3d75ea6f615c,04b28435-8c48-47cd-b2c3-5f672457eee4,29503f86-a2ef-45d2-864a-18a9e43e37c0,987bf5ff-7156-4c70-9243-5e27d8eec340,2214d0f3-4019-474a-92f9-704355396a62,1bb13b53-b01b-4d27-a9dd-39c1dae1015d,10c68cd9-e273-4022-a6a7-2b44f96f1808,94087124-308f-4437-aac2-8af0c4598cd2,d686ceeb-3292-462b-b388-5de12c3e2a64}	{}
\.

COPY public.goods_receipts (id, receipt_code, po_id, facility_id, received_by_id, received_at, note) FROM stdin;
1	GR-20261124-005757	2	2046	39	2026-11-24 10:08:23.147906+00	\N
2	GR-20261124-43FAAF	1	2046	39	2026-11-24 10:09:43.793796+00	\N
\.

COPY public.internal_transfers (id, transfer_code, order_id, from_facility_id, to_facility_id, status, items, tracking_code, distance_km, estimated_hours, notes, dispatched_at, received_at, created_at, updated_at, transport_mode, transport_employee_id, transport_employee_name, courier_name, variance_details, return_reason, returned_at, discrepancy_status, transfer_type, request_id) FROM stdin;
1	STR-STQ-20261124-EBDAB3	\N	2045	2046	RECEIVED	[{"quantity": 20, "unitName": "Blister Pack", "variantId": 11, "medicineId": 9}]	\N	\N	24	\N	2026-11-24 09:46:00.675+00	2026-11-24 09:46:38.523+00	2026-11-24 09:45:26.519736+00	2026-11-24 09:46:38.523+00	INTERNAL	15	Factory Warehouse Staff	\N	[{"notes": null, "goodUids": ["00d3d676-808d-4e7d-90be-24fcaf4914aa", "0adb66a2-5500-4e8e-a69c-6595eea5205b", "1c7e907f-16dc-4cc8-9862-325bb89bd162", "2d2a2155-01f0-43da-a6dd-7532ba5d5fd2", "39284525-d974-4a81-84fd-ae50b67ccfd6", "4d695c75-a991-4531-957f-d865d45db4ec", "4f4c10a8-086e-4f5b-9df8-256246394032", "5a97163a-bd83-4a97-9507-7435eb944856", "61b7ff66-02c9-42a8-a641-4078f546678b", "7a118430-dae6-448b-be5b-03a1e9aa9a9b", "9d1e777e-3c7e-4cee-b4eb-6f38464bdcba", "9d77c5d2-ebad-4213-9ff8-7322dcb7e825", "a1b5ab1f-7354-436e-a0f2-e78018443721", "af8e42fd-ef43-4104-81e2-d0939fa640e0", "beaa161d-e788-4801-82d3-c8992785d857", "c6ffdf87-aa58-48c4-8109-4bbc192f85ec", "cd3d00ac-3407-4542-8781-e3f3cf457d35", "e514ffd4-e438-485b-8009-8298afdce6e5", "f25b57c6-4a84-48e6-ae2a-fb5c91679f25", "f32a0c25-e74d-484c-8426-d6a925d00fe6"], "variantId": 11, "medicineId": 9, "damagedUids": [], "missingUids": [], "goodQuantity": 20, "totalQuantity": 20, "damagedQuantity": 0, "missingQuantity": 0}]	\N	\N	NONE	REPLENISHMENT	1
2	STR-STQ-20261124-C1030B	\N	2045	2046	RECEIVED_WITH_DISCREPANCY	[{"quantity": 20, "unitName": "Blister Pack", "variantId": 11, "medicineId": 9}]	\N	\N	24	Received with discrepancy: 1 damaged, 0 missing. Notes: 1 damaged product	2026-11-24 09:59:18.968+00	2026-11-24 10:02:19.3+00	2026-11-24 09:58:46.748842+00	2026-11-24 10:02:19.3+00	INTERNAL	15	Factory Warehouse Staff	\N	[{"notes": null, "goodUids": ["1106d01f-ae15-427d-a36a-8299b321754a", "2abdacb4-d713-4555-a823-d884612ba85e", "359ccd95-4e9b-46fa-8410-cae4b90ee0d9", "3803b476-baf5-45c1-a045-1800af7cff5a", "398b5aa0-12ae-450e-81d2-94f5a01949a0", "527f5ea9-a0c9-4da4-b0d8-26c4291a9754", "5ca13667-9fed-404d-b57a-75150b080ed4", "622a4974-2b81-4d29-8ee2-bbd07b91651a", "630d2bb4-5cee-439c-a846-bd0726aaa890", "8bcdfdd0-f111-4efc-9464-5deac52dd0f8", "986e40a9-ad42-4e13-b702-39c523ab04ee", "a350414f-3c2c-4323-bb4c-f44eae071d82", "a4253d92-fd3b-40cd-95ef-5da805d736ee", "b4e4cf49-972b-49e6-9d4b-abbd0e0bf5dc", "c3f42115-9454-4ecc-8a83-662a40769ef5", "c8f579d0-dba8-4ae4-8650-8ee87a1e9a9d", "d18fc531-95ef-4f1c-bf21-21281bf7b343", "db50d3c4-e2dc-4ea2-989c-47c4796490d2", "e78c1e5b-4aaf-47c7-82c3-9f5b44ed2bda"], "variantId": 11, "medicineId": 9, "damagedUids": ["1377a656-a997-46c7-8349-12cdc2557c31"], "missingUids": [], "goodQuantity": 19, "totalQuantity": 20, "damagedQuantity": 1, "missingQuantity": 0}]	\N	\N	DISCREPANCY	REPLENISHMENT	3
3	STR-STQ-20261124-3C942A	\N	2045	2046	RECEIVED	[{"quantity": 20, "unitName": "Box", "variantId": 822, "medicineId": 1797}]	\N	\N	24	\N	2026-11-24 10:14:51.151+00	2026-11-24 10:15:03.358+00	2026-11-24 10:14:05.691221+00	2026-11-24 10:15:03.358+00	INTERNAL	15	Factory Warehouse Staff	\N	[{"notes": null, "goodUids": ["03a7cbe3-ba6e-482a-ba8a-27b7f82f5b46", "0d209da7-25a0-4273-b992-12e1792227a6", "0eee645d-7348-4302-b3c1-769d30bce2f5", "117e95b5-10e3-4892-98bd-a6be938aa9ac", "16e4697d-7c90-4831-a9f8-5e877c90955a", "2499d91e-b3be-47f5-ae57-c2b206281fce", "252c344b-0fe0-48cc-b638-43a784a31b61", "28dd3368-4740-4694-83a9-995532a470ac", "32a6ed8e-044e-4379-8583-380e9c477a85", "3fb196f7-a8d2-43e3-b36a-1beb905849d7", "52693654-48c5-40e1-87e7-97423110acf0", "602efeac-0ae7-47df-90eb-d6f55e62778c", "61a621f9-2da6-4bcf-9555-9ddb0af2cdf4", "61d99a2c-4851-4f02-8045-4ff7f00c2f51", "74b7af20-05d0-4e21-8a06-d8f2f42797e8", "7adbbca7-4db6-48ca-be87-8fc036b608cc", "be20cd02-2cc8-466f-afcd-17626269266e", "c38adc3f-4bb1-4b82-abf8-dc877e232d21", "d714574d-22df-4d2c-b9c9-9a6c02f5f4b2", "df32f9a6-bad1-43d2-874a-997facfe5568"], "variantId": 822, "medicineId": 1797, "damagedUids": [], "missingUids": [], "goodQuantity": 20, "totalQuantity": 20, "damagedQuantity": 0, "missingQuantity": 0}]	\N	\N	NONE	REPLENISHMENT	4
4	STR-STQ-20261124-CADF45	\N	2046	1	RECEIVED	[{"quantity": 20, "unitName": "Blister Pack", "variantId": 11, "medicineId": 9}, {"quantity": 20, "unitName": "Box", "variantId": 822, "medicineId": 1797}]	\N	\N	24	\N	2026-11-24 10:18:51.501+00	2026-11-24 10:19:15.004+00	2026-11-24 10:15:46.718018+00	2026-11-24 10:19:15.004+00	INTERNAL	39	Warehouse Manager	\N	[{"notes": null, "goodUids": ["00d3d676-808d-4e7d-90be-24fcaf4914aa", "0adb66a2-5500-4e8e-a69c-6595eea5205b", "1c7e907f-16dc-4cc8-9862-325bb89bd162", "2d2a2155-01f0-43da-a6dd-7532ba5d5fd2", "39284525-d974-4a81-84fd-ae50b67ccfd6", "4d695c75-a991-4531-957f-d865d45db4ec", "4f4c10a8-086e-4f5b-9df8-256246394032", "5a97163a-bd83-4a97-9507-7435eb944856", "61b7ff66-02c9-42a8-a641-4078f546678b", "7a118430-dae6-448b-be5b-03a1e9aa9a9b", "9d1e777e-3c7e-4cee-b4eb-6f38464bdcba", "9d77c5d2-ebad-4213-9ff8-7322dcb7e825", "a1b5ab1f-7354-436e-a0f2-e78018443721", "af8e42fd-ef43-4104-81e2-d0939fa640e0", "beaa161d-e788-4801-82d3-c8992785d857", "c6ffdf87-aa58-48c4-8109-4bbc192f85ec", "cd3d00ac-3407-4542-8781-e3f3cf457d35", "e514ffd4-e438-485b-8009-8298afdce6e5", "f25b57c6-4a84-48e6-ae2a-fb5c91679f25", "f32a0c25-e74d-484c-8426-d6a925d00fe6"], "variantId": 11, "medicineId": 9, "damagedUids": [], "missingUids": [], "goodQuantity": 20, "totalQuantity": 20, "damagedQuantity": 0, "missingQuantity": 0}, {"notes": null, "goodUids": ["03a7cbe3-ba6e-482a-ba8a-27b7f82f5b46", "0d209da7-25a0-4273-b992-12e1792227a6", "0eee645d-7348-4302-b3c1-769d30bce2f5", "117e95b5-10e3-4892-98bd-a6be938aa9ac", "16e4697d-7c90-4831-a9f8-5e877c90955a", "2499d91e-b3be-47f5-ae57-c2b206281fce", "252c344b-0fe0-48cc-b638-43a784a31b61", "28dd3368-4740-4694-83a9-995532a470ac", "32a6ed8e-044e-4379-8583-380e9c477a85", "3fb196f7-a8d2-43e3-b36a-1beb905849d7", "52693654-48c5-40e1-87e7-97423110acf0", "602efeac-0ae7-47df-90eb-d6f55e62778c", "61a621f9-2da6-4bcf-9555-9ddb0af2cdf4", "61d99a2c-4851-4f02-8045-4ff7f00c2f51", "74b7af20-05d0-4e21-8a06-d8f2f42797e8", "7adbbca7-4db6-48ca-be87-8fc036b608cc", "be20cd02-2cc8-466f-afcd-17626269266e", "c38adc3f-4bb1-4b82-abf8-dc877e232d21", "d714574d-22df-4d2c-b9c9-9a6c02f5f4b2", "df32f9a6-bad1-43d2-874a-997facfe5568"], "variantId": 822, "medicineId": 1797, "damagedUids": [], "missingUids": [], "goodQuantity": 20, "totalQuantity": 20, "damagedQuantity": 0, "missingQuantity": 0}]	\N	\N	NONE	REPLENISHMENT	5
5	STR-STQ-20261124-285973	\N	2045	2046	RECEIVED	[{"quantity": 5, "unitName": "Blister Pack", "variantId": 11, "medicineId": 9}]	\N	\N	24	\N	2026-11-24 13:22:05.092+00	2026-11-24 13:22:15.636+00	2026-11-24 13:21:51.404092+00	2026-11-24 13:22:15.636+00	INTERNAL	15	Factory Warehouse Staff	\N	[{"notes": null, "goodUids": ["05b07c94-6d47-4ff8-9a88-70ea9c1e6f30", "475f6836-d23a-4fdd-8013-fb4b1573974d", "bc90a554-ceb8-43cb-81cd-dd6329fe15fc", "d19dd4b7-61d9-42e7-aa21-9b539f390d82", "dd6366cf-0367-4a82-b99c-79b657efd92d"], "variantId": 11, "medicineId": 9, "damagedUids": [], "missingUids": [], "goodQuantity": 5, "totalQuantity": 5, "damagedQuantity": 0, "missingQuantity": 0}]	\N	\N	NONE	REPLENISHMENT	6
6	RCL-RCL-20261124-Q6PB-6	\N	2046	2045	RECEIVED	[{"quantity": 5, "unitName": "Blister Pack", "variantId": 11, "medicineId": 9}]	\N	\N	24	Recall RCL-20261124-Q6PB	2026-11-24 14:37:13.384+00	2026-11-24 14:37:30.488+00	2026-11-24 14:33:20.180533+00	2026-11-24 14:37:30.488+00	INTERNAL	39	Warehouse Manager	\N	[{"notes": null, "goodUids": ["05b07c94-6d47-4ff8-9a88-70ea9c1e6f30", "475f6836-d23a-4fdd-8013-fb4b1573974d", "bc90a554-ceb8-43cb-81cd-dd6329fe15fc", "d19dd4b7-61d9-42e7-aa21-9b539f390d82", "dd6366cf-0367-4a82-b99c-79b657efd92d"], "variantId": 11, "medicineId": 9, "damagedUids": [], "missingUids": [], "goodQuantity": 5, "totalQuantity": 5, "damagedQuantity": 0, "missingQuantity": 0}]	\N	\N	NONE	RECALL_COLLECTION	\N
\.

COPY public.inventories (id, facility_id, medicine_id, variant_id, stock_quantity, reserved_quantity, updated_at, min_stock_quantity) FROM stdin;
3	2045	1797	822	40	0	2026-11-24 10:14:51.088664	\N
8	2046	\N	822	0	0	2026-11-24 10:18:51.399301	\N
10	1	\N	822	19	0	2026-11-24 12:09:39.974616	\N
9	1	\N	11	20	0	2026-11-24 12:54:43.448	\N
5	2046	\N	11	14	0	2026-11-24 14:37:13.337929	\N
1	2045	9	11	40	0	2026-11-24 14:37:30.427114	\N
\.

COPY public.inventory_logs (id, facility_id, medicine_id, transaction_type, quantity_changed, previous_quantity, new_quantity, reference_code, note, performed_by_id, created_at, variant_id, stock_bucket, batch_id) FROM stdin;
1	2045	9	PRODUCTION_IN	60	0	60	FB-1	Factory batch LOT-A-2026-01	15	2026-11-24 09:38:05.512234	11	ON_HAND	1
2	2045	9	PRODUCTION_IN	30	60	90	FB-2	Factory batch LOT-2026-1-NEAR-EXPIRED	15	2026-11-24 09:39:01.006432	11	ON_HAND	2
3	2045	1797	PRODUCTION_IN	60	0	60	FB-3	Factory batch LOT-2026-1-RX	15	2026-11-24 09:40:22.179805	822	ON_HAND	3
4	2045	9	PRODUCTION_IN	5	90	95	FB-4	Factory batch LOT-2026-1-WRONG	15	2026-11-24 09:40:56.250437	11	ON_HAND	4
5	2045	9	RECALL_HOLD	-5	95	90	RCL-20261124-1XLB	Recall hold: 5	15	2026-11-24 09:42:16.273321	11	ON_HAND	4
6	2045	9	RECALL_HOLD	5	0	5	RCL-20261124-1XLB	Recall hold: 5	15	2026-11-24 09:42:16.273321	11	QUARANTINE	4
7	2045	9	TRANSFER_DISPATCH	-20	90	70	STR-STQ-20261124-EBDAB3	Handed over to transport custody	15	2026-11-24 09:46:00.617388	11	ON_HAND	\N
8	2046	9	TRANSFER_IN	20	0	20	STR-STQ-20261124-EBDAB3	Received from PharmaTrace Factory - Binh Duong for transfer #STR-STQ-20261124-EBDAB3	39	2026-11-24 09:46:38.492	11	ON_HAND	\N
9	2045	9	TRANSFER_OUT	-20	20	0	STR-STQ-20261124-EBDAB3	Transfer to PharmaTrace Distribution Hub - HCMC for transfer #STR-STQ-20261124-EBDAB3	39	2026-11-24 09:46:38.5	11	IN_TRANSIT	\N
10	2045	9	TRANSFER_DISPATCH	-20	70	50	STR-STQ-20261124-C1030B	Handed over to transport custody	15	2026-11-24 09:59:18.924429	11	ON_HAND	\N
11	2046	9	TRANSFER_IN	19	20	39	STR-STQ-20261124-C1030B	Received from PharmaTrace Factory - Binh Duong for transfer #STR-STQ-20261124-C1030B	39	2026-11-24 10:02:19.262	11	ON_HAND	\N
12	2046	9	QUARANTINE_IN	1	0	1	STR-STQ-20261124-C1030B	IN: 1 units	39	2026-11-24 10:02:19.214048	11	QUARANTINE	\N
13	2045	9	TRANSFER_OUT	-20	20	0	STR-STQ-20261124-C1030B	Transfer to PharmaTrace Distribution Hub - HCMC for transfer #STR-STQ-20261124-C1030B	39	2026-11-24 10:02:19.278	11	IN_TRANSIT	\N
14	2045	9	PO_SHIPMENT_OUT	-10	50	40	GR-20261124-005757	PO-20261124-F8EAB6, batch LOT-2026-1-NEAR-EXPIRED	39	2026-11-24 10:08:23.147906	11	ON_HAND	2
15	2046	9	PURCHASE_IN	10	39	49	GR-20261124-005757	PO-20261124-F8EAB6, batch LOT-2026-1-NEAR-EXPIRED	39	2026-11-24 10:08:23.147906	11	ON_HAND	2
16	2046	9	PURCHASE_IN	10	49	59	GR-20261124-43FAAF	PO-20261124-32DB1B, batch LOT-2026-2-RESTOCK	39	2026-11-24 10:09:43.793796	11	ON_HAND	5
17	2045	1797	TRANSFER_DISPATCH	-20	60	40	STR-STQ-20261124-3C942A	Handed over to transport custody	15	2026-11-24 10:14:51.088664	822	ON_HAND	\N
18	2046	1797	TRANSFER_IN	20	0	20	STR-STQ-20261124-3C942A	Received from PharmaTrace Factory - Binh Duong for transfer #STR-STQ-20261124-3C942A	39	2026-11-24 10:15:03.344	822	ON_HAND	\N
19	2045	1797	TRANSFER_OUT	-20	20	0	STR-STQ-20261124-3C942A	Transfer to PharmaTrace Distribution Hub - HCMC for transfer #STR-STQ-20261124-3C942A	39	2026-11-24 10:15:03.345	822	IN_TRANSIT	\N
20	2046	9	TRANSFER_DISPATCH	-20	59	39	STR-STQ-20261124-CADF45	Handed over to transport custody	39	2026-11-24 10:18:51.399301	11	ON_HAND	\N
21	2046	1797	TRANSFER_DISPATCH	-20	20	0	STR-STQ-20261124-CADF45	Handed over to transport custody	39	2026-11-24 10:18:51.399301	822	ON_HAND	\N
22	1	9	TRANSFER_IN	20	0	20	STR-STQ-20261124-CADF45	Received from PharmaTrace Distribution Hub - HCMC for transfer #STR-STQ-20261124-CADF45	12	2026-11-24 10:19:14.961	11	ON_HAND	\N
23	2046	9	TRANSFER_OUT	-20	20	0	STR-STQ-20261124-CADF45	Transfer to Enervon Pharmacy Store #1 for transfer #STR-STQ-20261124-CADF45	12	2026-11-24 10:19:14.965	11	IN_TRANSIT	\N
24	1	1797	TRANSFER_IN	20	0	20	STR-STQ-20261124-CADF45	Received from PharmaTrace Distribution Hub - HCMC for transfer #STR-STQ-20261124-CADF45	12	2026-11-24 10:19:14.988	822	ON_HAND	\N
25	2046	1797	TRANSFER_OUT	-20	20	0	STR-STQ-20261124-CADF45	Transfer to Enervon Pharmacy Store #1 for transfer #STR-STQ-20261124-CADF45	12	2026-11-24 10:19:14.991	822	IN_TRANSIT	\N
26	1	1797	ORDER_PACKED	-1	20	19	ORD-261124-AD442170	Order #ORD-261124-AD442170 packed with 1 Box(s)	13	2026-11-24 12:09:40.075	822	ON_HAND	\N
27	1	9	ORDER_PACKED	-1	20	19	ORD-261124-A38BEC4E	Order #ORD-261124-A38BEC4E packed with 1 Blister Pack(s)	13	2026-11-24 12:12:03.931	11	ON_HAND	\N
28	2046	9	ORDER_PACKED	-25	39	14	ORD-261124-8C540BB8	Order #ORD-261124-8C540BB8 packed with 25 Blister Pack(s)	14	2026-11-24 12:30:12.323	11	ON_HAND	\N
29	1	9	QUARANTINE_IN	1	0	1	RMA-261124-F342BB	IN: 1 units	12	2026-11-24 12:54:35.596422	11	QUARANTINE	\N
30	1	9	QUARANTINE_TO_STOCK	-1	1	0	RMA-261124-F342BB	RESTOCK: 1 units	12	2026-11-24 12:54:43.426257	11	QUARANTINE	\N
31	1	9	RETURN_RESTOCK	1	19	20	RMA-261124-F342BB	Restocked 1 unit(s) that passed inspection from RMA-261124-F342BB	12	2026-11-24 12:54:43.469	11	ON_HAND	\N
32	2045	9	PRODUCTION_IN	10	40	50	FB-6	Factory batch LOT-2026-RECALL	15	2026-11-24 13:20:50.404252	11	ON_HAND	6
33	2045	9	TRANSFER_DISPATCH	-5	50	45	STR-STQ-20261124-285973	Handed over to transport custody	15	2026-11-24 13:22:05.043968	11	ON_HAND	\N
34	2046	9	TRANSFER_IN	5	14	19	STR-STQ-20261124-285973	Received from PharmaTrace Factory - Binh Duong for transfer #STR-STQ-20261124-285973	39	2026-11-24 13:22:15.622	11	ON_HAND	\N
35	2045	9	TRANSFER_OUT	-5	5	0	STR-STQ-20261124-285973	Transfer to PharmaTrace Distribution Hub - HCMC for transfer #STR-STQ-20261124-285973	39	2026-11-24 13:22:15.625	11	IN_TRANSIT	\N
36	2045	9	RECALL_HOLD	-5	45	40	RCL-20261124-Q6PB	Recall hold: 5	15	2026-11-24 13:24:26.078361	11	ON_HAND	6
37	2045	9	RECALL_HOLD	5	5	10	RCL-20261124-Q6PB	Recall hold: 5	15	2026-11-24 13:24:26.078361	11	QUARANTINE	6
38	2046	9	RECALL_HOLD	-5	19	14	RCL-20261124-Q6PB	Recall hold: 5	15	2026-11-24 13:24:26.078361	11	ON_HAND	6
39	2046	9	RECALL_HOLD	5	1	6	RCL-20261124-Q6PB	Recall hold: 5	15	2026-11-24 13:24:26.078361	11	QUARANTINE	6
40	2046	9	RECALL_COLLECT	5	14	19	RCL-20261124-Q6PB	Recall collect: 5	39	2026-11-24 14:33:20.180533	11	ON_HAND	6
41	2046	9	RECALL_COLLECT	-5	6	1	RCL-20261124-Q6PB	Recall collect: 5	39	2026-11-24 14:33:20.180533	11	QUARANTINE	6
42	2046	9	TRANSFER_DISPATCH	-5	19	14	RCL-RCL-20261124-Q6PB-6	Handed over to transport custody	39	2026-11-24 14:37:13.337929	11	ON_HAND	\N
43	2045	9	TRANSFER_IN	5	40	45	RCL-RCL-20261124-Q6PB-6	Received from PharmaTrace Distribution Hub - HCMC for transfer #RCL-RCL-20261124-Q6PB-6	15	2026-11-24 14:37:30.472	11	ON_HAND	\N
44	2046	9	TRANSFER_OUT	-5	5	0	RCL-RCL-20261124-Q6PB-6	Transfer to PharmaTrace Factory - Binh Duong for transfer #RCL-RCL-20261124-Q6PB-6	15	2026-11-24 14:37:30.476	11	IN_TRANSIT	\N
45	2045	9	RECALL_HOLD	-5	45	40	RCL-20261124-Q6PB	Recall hold: 5	15	2026-11-24 14:37:30.427114	11	ON_HAND	6
46	2045	9	RECALL_HOLD	5	10	15	RCL-20261124-Q6PB	Recall hold: 5	15	2026-11-24 14:37:30.427114	11	QUARANTINE	6
47	2045	9	DISPOSAL	-10	15	5	DSP-20261124-07B8EC	Disposal DSP-20261124-07B8EC	15	2026-11-24 14:54:40.83109	11	QUARANTINE	6
\.

COPY public.logistics_cod_settlements (shipment_id, cashbook_id, amount, collected_by, collected_at, courier_fee, adjustment_amount, net_amount, statement_reference, discrepancy_amount, discrepancy_status, notes, created_at) FROM stdin;
2	1	50000.00	22	2026-11-24 12:39:29.327598+00	10000.00	0.00	40000.00	COD-STMT-A38BEC4E	0.00	NONE	\N	2026-11-24 12:39:29.327598+00
1	2	136818.00	22	2026-11-24 12:41:40.762979+00	30000.00	0.00	106818.00	COD-STMT-AD442170	0.00	NONE	\N	2026-11-24 12:41:40.762979+00
\.

COPY public.logistics_events (id, shipment_id, transfer_id, old_status, new_status, reason, actor_id, created_at, occurred_at, actor_type, actor_name, actor_role) FROM stdin;
1	\N	1	\N	REQUESTED	\N	15	2026-11-24 09:45:26.519736+00	2026-11-24 09:45:26.519736+00	employee	Factory Warehouse Staff	FACTORY_WAREHOUSE_STAFF
2	\N	1	REQUESTED	DISPATCHED	\N	15	2026-11-24 09:46:00.617388+00	2026-11-24 09:46:00.617388+00	employee	Factory Warehouse Staff	FACTORY_WAREHOUSE_STAFF
3	\N	1	DISPATCHED	RECEIVED	\N	39	2026-11-24 09:46:38.433327+00	2026-11-24 09:46:38.433327+00	employee	Warehouse Manager	WAREHOUSE_MANAGER
4	\N	2	\N	REQUESTED	\N	15	2026-11-24 09:58:46.748842+00	2026-11-24 09:58:46.748842+00	employee	Factory Warehouse Staff	FACTORY_WAREHOUSE_STAFF
5	\N	2	REQUESTED	DISPATCHED	\N	15	2026-11-24 09:59:18.924429+00	2026-11-24 09:59:18.924429+00	employee	Factory Warehouse Staff	FACTORY_WAREHOUSE_STAFF
6	\N	2	DISPATCHED	RECEIVED_WITH_DISCREPANCY	\N	39	2026-11-24 10:02:19.214048+00	2026-11-24 10:02:19.214048+00	employee	Warehouse Manager	WAREHOUSE_MANAGER
7	\N	3	\N	REQUESTED	\N	15	2026-11-24 10:14:05.691221+00	2026-11-24 10:14:05.691221+00	employee	Factory Warehouse Staff	FACTORY_WAREHOUSE_STAFF
8	\N	3	REQUESTED	DISPATCHED	\N	15	2026-11-24 10:14:51.088664+00	2026-11-24 10:14:51.088664+00	employee	Factory Warehouse Staff	FACTORY_WAREHOUSE_STAFF
9	\N	3	DISPATCHED	RECEIVED	\N	39	2026-11-24 10:15:03.313546+00	2026-11-24 10:15:03.313546+00	employee	Warehouse Manager	WAREHOUSE_MANAGER
10	\N	4	\N	REQUESTED	\N	39	2026-11-24 10:15:46.718018+00	2026-11-24 10:15:46.718018+00	employee	Warehouse Manager	WAREHOUSE_MANAGER
11	\N	4	REQUESTED	DISPATCHED	\N	39	2026-11-24 10:18:51.399301+00	2026-11-24 10:18:51.399301+00	employee	Warehouse Manager	WAREHOUSE_MANAGER
12	\N	4	DISPATCHED	RECEIVED	\N	12	2026-11-24 10:19:14.931799+00	2026-11-24 10:19:14.931799+00	employee	Store Manager	STORE_MANAGER
13	1	\N	\N	PENDING_PICKUP	\N	13	2026-11-24 12:09:39.974616+00	2026-11-24 12:09:39.974616+00	employee	Pharmacist	PHARMACIST
14	1	\N	\N	PENDING_PICKUP	Carrier updated: EXPRESS_LOGISTICS/TRK-ORD-261124-AD442170-0096 -> GHTK/GHTK-261124-AD4421	13	2026-11-24 12:10:18.380167+00	2026-11-24 12:10:18.380167+00	employee	Pharmacist	PHARMACIST
15	1	\N	PENDING_PICKUP	PICKED_UP	\N	13	2026-11-24 12:10:43.271923+00	2026-11-24 12:10:41+00	employee	Pharmacist	PHARMACIST
16	1	\N	PICKED_UP	IN_TRANSIT	\N	13	2026-11-24 12:10:54.777088+00	2026-11-24 12:10:54.776+00	employee	Pharmacist	PHARMACIST
17	1	\N	IN_TRANSIT	DELIVERED	Customer confirmed receipt	17	2026-11-24 12:11:18.090524+00	2026-11-24 12:11:18.090524+00	customer	\N	\N
18	2	\N	\N	PENDING_PICKUP	\N	13	2026-11-24 12:12:03.848833+00	2026-11-24 12:12:03.848833+00	employee	Pharmacist	PHARMACIST
19	2	\N	\N	PENDING_PICKUP	Carrier updated: EXPRESS_LOGISTICS/TRK-ORD-261124-A38BEC4E-3957 -> EXPRESS_LOGISTICS/TRK-ORD-261124-A38BEC4E-0001	13	2026-11-24 12:12:12.466833+00	2026-11-24 12:12:12.466833+00	employee	Pharmacist	PHARMACIST
20	2	\N	\N	PENDING_PICKUP	Carrier updated: EXPRESS_LOGISTICS/TRK-ORD-261124-A38BEC4E-0001 -> GHN/GHN-ORD-261124-A38BEC4E	13	2026-11-24 12:13:01.754413+00	2026-11-24 12:13:01.754413+00	employee	Pharmacist	PHARMACIST
21	2	\N	PENDING_PICKUP	PICKED_UP	\N	13	2026-11-24 12:13:04.272308+00	2026-11-24 12:13:04.272+00	employee	Pharmacist	PHARMACIST
22	2	\N	PICKED_UP	IN_TRANSIT	\N	13	2026-11-24 12:13:10.65882+00	2026-11-24 12:13:10.658+00	employee	Pharmacist	PHARMACIST
23	2	\N	IN_TRANSIT	DELIVERED	Customer confirmed receipt	17	2026-11-24 12:13:21.078346+00	2026-11-24 12:13:21.078346+00	customer	\N	\N
24	3	\N	\N	PENDING_PICKUP	\N	14	2026-11-24 12:30:12.246685+00	2026-11-24 12:30:12.246685+00	employee	Warehouse Staff	WAREHOUSE_STAFF
25	3	\N	\N	PENDING_PICKUP	Carrier updated: EXPRESS_LOGISTICS/TRK-ORD-261124-8C540BB8-2344 -> GHN/GHN-ORD-261124-8C540BB8	11	2026-11-24 12:31:55.569308+00	2026-11-24 12:31:55.569308+00	employee	Super Admin	SUPER_ADMIN
26	3	\N	PENDING_PICKUP	PICKED_UP	Carrier handover HOV-20261124-D83D6D	14	2026-11-24 12:32:20.573721+00	2026-11-24 12:32:20.573721+00	employee	Warehouse Staff	WAREHOUSE_STAFF
27	\N	5	\N	REQUESTED	\N	15	2026-11-24 13:21:51.404092+00	2026-11-24 13:21:51.404092+00	employee	Factory Warehouse Staff	FACTORY_WAREHOUSE_STAFF
28	\N	5	REQUESTED	DISPATCHED	\N	15	2026-11-24 13:22:05.043968+00	2026-11-24 13:22:05.043968+00	employee	Factory Warehouse Staff	FACTORY_WAREHOUSE_STAFF
29	\N	5	DISPATCHED	RECEIVED	\N	39	2026-11-24 13:22:15.583202+00	2026-11-24 13:22:15.583202+00	employee	Warehouse Manager	WAREHOUSE_MANAGER
30	\N	6	\N	REQUESTED	\N	39	2026-11-24 14:33:20.180533+00	2026-11-24 14:33:20.180533+00	employee	Warehouse Manager	WAREHOUSE_MANAGER
31	\N	6	REQUESTED	DISPATCHED	\N	39	2026-11-24 14:37:13.337929+00	2026-11-24 14:37:13.337929+00	employee	Warehouse Manager	WAREHOUSE_MANAGER
32	\N	6	DISPATCHED	RECEIVED	\N	15	2026-11-24 14:37:30.427114+00	2026-11-24 14:37:30.427114+00	employee	Factory Warehouse Staff	FACTORY_WAREHOUSE_STAFF
\.

COPY public.medicine_boxes (uid, batch_id, carton_id, current_facility_id, status, signature, public_key, created_at) FROM stdin;
1df14bd6-e9c3-431d-90c5-bf702f343d55	2	4	2046	IN_TRANSIT	39ad698d37609a9b1f4bb8666abf5ffc7bae88795bdacaa5d1129d62e3799233	\N	2026-11-24 09:39:01.006432
a82b0fd8-c05f-4972-8a14-89d04062ee21	2	4	2046	IN_TRANSIT	657f30adb300b763387f70fd8c2238c00729fc8d88b878dceaa49581535cdd49	\N	2026-11-24 09:39:01.006432
d060090a-db1d-43f7-bca0-e32fa89b8900	2	4	2046	IN_TRANSIT	6a540d5879f6ce2a4e253c29f0ae79e848ca5d36e073164eb5b629085c48236a	\N	2026-11-24 09:39:01.006432
08522e76-26fe-4605-b8b5-c11fbb3be573	2	4	2046	IN_TRANSIT	ed76c5dc4be135cb7dc459175ee1166925bf1fcc015a1d2d446cc6fce512c601	\N	2026-11-24 09:39:01.006432
85a39f1e-2190-4192-9cbc-faba709adf30	2	4	2046	IN_TRANSIT	32182bff8b7b168cc8f47725dfb7746d72ce74afb3bea1fb3f0ae11786f8ad61	\N	2026-11-24 09:39:01.006432
d686ceeb-3292-462b-b388-5de12c3e2a64	5	\N	2046	IN_TRANSIT	13962c3958051982d983f80a2f904768218078bed862f97322bb7164cf8f9c1b	\N	2026-11-24 10:09:43.793796
7cb84802-3826-423e-a026-4e74bf4e0de3	2	4	2046	IN_TRANSIT	4965f05fbb2ad57e84e8d161839b8d511a9b56d306005e26808c25d0650f5cdc	\N	2026-11-24 09:39:01.006432
9453bbdc-4dc7-44a3-9acf-c3edfbb95306	2	4	2046	IN_TRANSIT	2587c61722c1a6444647f11659be5cc82e073d5b4f7596ce44ca9f7071a6b189	\N	2026-11-24 09:39:01.006432
b651621c-14a1-4b7f-8e9e-173fb64e3158	2	4	2046	IN_TRANSIT	fa9de54883e6d18bbdf93d42ed54e0e4286a05e0610d29f14f313b1afaed7e40	\N	2026-11-24 09:39:01.006432
0da596b3-c5b5-409f-96a4-f999a90b8774	2	4	2046	IN_TRANSIT	5ba85bf56eca00ba57f5e1f493775013383f64a84c6dad4d3ad9cf90f63bdf5d	\N	2026-11-24 09:39:01.006432
b3c378a8-848c-45ef-b0ef-c7c2526789b4	2	4	2046	IN_TRANSIT	4da2fc1119b32fd329a16540f0de7f4417de39fe11908ddde64f156600721c41	\N	2026-11-24 09:39:01.006432
61ee713a-e4e3-463c-9528-238b9a4afd04	1	3	2045	IN_STOCK	984a815b9e5662698362a1e8c98e770565a6bcf2cdc7c1b38aa6dda0eb9fee07	\N	2026-11-24 09:38:05.512234
60799c85-95dc-4627-9cb1-144083795a71	1	3	2045	IN_STOCK	552167e2cdce51a794751986fd29bf01e360673d4e88cf4497e4ca4c8398e9f8	\N	2026-11-24 09:38:05.512234
5d1af520-1dd5-4988-8367-c0988c894b38	1	3	2045	IN_STOCK	22f04ea43ff4a052b1d91b0440e0bb023fd498f7609241686e30375021e92a13	\N	2026-11-24 09:38:05.512234
3e98cca5-5908-4e70-91e1-465b96ddb1cb	1	3	2045	IN_STOCK	482dc278e0693b32a472ea63f9efd1ff7adce5a34d15998083b0950dae708a9f	\N	2026-11-24 09:38:05.512234
6bab09ac-355f-497d-97d2-b56bf8cfd6a7	1	3	2045	IN_STOCK	646012ddbf8654c7642fcbf9ca93a9b854f4b5588725070bcb239eaa2d9bd372	\N	2026-11-24 09:38:05.512234
ded9c316-8229-4dfe-89d3-7d341390e3a4	1	3	2045	IN_STOCK	cc864eec9c8105effa55d1da8c7caa3a989d4c26d3b7bae70497bf62a4bb52d8	\N	2026-11-24 09:38:05.512234
69fd1c19-de1a-4d81-b655-3221bc342712	1	3	2045	IN_STOCK	f3e2519c742eb2fadfe19842b4e16b9d4691c9afd45e01ca4f182da75ce41385	\N	2026-11-24 09:38:05.512234
c2bdcd77-3694-4295-852f-83b0c71994dc	1	3	2045	IN_STOCK	27beaff390cfc4ac856204986d1a06e4c808ef820343a19d37f442ab39264c05	\N	2026-11-24 09:38:05.512234
75ad2c31-d2f1-4456-b577-76c374b60749	1	3	2045	IN_STOCK	495b0606b64b85c8133d0cd0f7d53c7e87f25bda1720456fa5638c4d67632a23	\N	2026-11-24 09:38:05.512234
7bfde78d-b5dd-4831-ada4-9141e8d700c9	1	3	2045	IN_STOCK	038af0f1e745b4f94fbe221f78bc77f820e5805229caec34eefa65b7973b366a	\N	2026-11-24 09:38:05.512234
f49f9bf5-16ae-46d4-b71c-b53ff4fca58e	1	3	2045	IN_STOCK	6f31d9ec4829c4999f571df6617520aa83c9577e1d962a531fe7c6eaf8e488d1	\N	2026-11-24 09:38:05.512234
78dd81b9-c723-4804-b46f-89a7a09e3a65	1	3	2045	IN_STOCK	e1324ae24e3be681e9d9816b0361b9fb47f0e12b35799e23733bc4cfaa7a501c	\N	2026-11-24 09:38:05.512234
63816c0e-5c99-4b92-98f4-f79617b87507	1	3	2045	IN_STOCK	45297ad45118fb5840c2040e970dbf386a985787a4d7bfed6bd99ffee8b7aa66	\N	2026-11-24 09:38:05.512234
fe045605-2eaa-4898-a47a-78d724edd80b	1	3	2045	IN_STOCK	556af9fbaaca6cd77683352659c15d8370c4c67f71459ca47c44cf564f60612d	\N	2026-11-24 09:38:05.512234
db7c2433-8135-4222-a7eb-8b8e1000d19c	1	3	2045	IN_STOCK	c1fc0b68ae8a5884a372a8837b8d9ff1a13f38cf23b7ecb1ea57719c0af707f4	\N	2026-11-24 09:38:05.512234
9ec7a23d-4e58-4ee5-8446-6d1f3bdf0822	1	3	2045	IN_STOCK	162c604d8ef655a267f6e49f445e6f48e079b5347d2ca4f960b5848afcce0769	\N	2026-11-24 09:38:05.512234
bb29a23e-1724-4fd9-a6c0-0ae7cce01d19	1	3	2045	IN_STOCK	082cb6587f751423bf640e64dbe9eac015a805a50d8c1fa67477981fca4989c4	\N	2026-11-24 09:38:05.512234
4061d8f4-e025-4aac-800f-5721a30e7704	1	3	2045	IN_STOCK	2ccd7ef5b1b6b384849350617475a0edde7aa3685b70be519874f003b07eae22	\N	2026-11-24 09:38:05.512234
ff0da260-c9a5-4661-b591-1216c28ea677	6	12	2045	DESTROYED	92a801f57307692bcc14e63c1480f737e947ab025a00e1448ad8ab32a2176913	\N	2026-11-24 13:20:50.404252
ff04accd-4a81-46c1-b6ed-03644420b326	6	12	2045	DESTROYED	4398b164c2425aefa6f067ec441d4dd53ff51ef4fe13d50d57a6c68050613bd4	\N	2026-11-24 13:20:50.404252
3f710c3f-6cd0-4f49-beba-ddf1d7491e59	6	12	2045	DESTROYED	893be0b3341abf634a9889a93fd5234193712f35f7dc2b64faa272d36b330534	\N	2026-11-24 13:20:50.404252
f8a00734-684c-4e89-b9fa-9bcc1b508c16	6	12	2045	DESTROYED	2871414ae766dd5f825820b339b998d881f1686ecff5d32dfbcca4edfc5169d8	\N	2026-11-24 13:20:50.404252
c21e0c80-05b8-482c-9428-e1a398b96d0d	6	12	2045	DESTROYED	cfc8b6436eb8e57e9608109ba78bfd8013651cb5936936e7d376fcd5c391ea73	\N	2026-11-24 13:20:50.404252
475f6836-d23a-4fdd-8013-fb4b1573974d	6	11	2045	DESTROYED	ae06734ce8188817eeb16f309529198fdc5cf8e9ecd6b691304b586a3266e67c	\N	2026-11-24 13:20:50.404252
bc90a554-ceb8-43cb-81cd-dd6329fe15fc	6	11	2045	DESTROYED	d8e9f550bdf8618a60c14e92fc9aa66350748fb9e23bd5b443c615173f11a6f0	\N	2026-11-24 13:20:50.404252
7a9cfde6-3cf1-40fe-ac64-f74b6bcba1e6	1	3	2045	IN_STOCK	2207bf39277271287c7c5cd433230a164dac9bff0b0d4fd096774c342c8cf14b	\N	2026-11-24 09:38:05.512234
0c3c875a-2950-4160-823b-da1bb2fe1f85	1	3	2045	IN_STOCK	485e31a905202bd2187b199362877ae0f303204c264a054db29ec3f54e11cf99	\N	2026-11-24 09:38:05.512234
00d3d676-808d-4e7d-90be-24fcaf4914aa	1	1	1	IN_STOCK	32a79b5465eff93a79d78e1e4a4c894c352efad14d519ebac64c7457c95718aa	\N	2026-11-24 09:38:05.512234
d19dd4b7-61d9-42e7-aa21-9b539f390d82	6	11	2045	DESTROYED	0ca596bf462cb38cf8861e3fc46a8907f58d241699c700441c27c7d4ea928e06	\N	2026-11-24 13:20:50.404252
dd6366cf-0367-4a82-b99c-79b657efd92d	6	11	2045	DESTROYED	6b4172a2264d1fbcfa36bf70c003a0d78ba7f9f93c7738040869b519ce79af66	\N	2026-11-24 13:20:50.404252
05b07c94-6d47-4ff8-9a88-70ea9c1e6f30	6	11	2045	DESTROYED	296b91c51a002ac604ba5e302857fbd25cbb0cdb4fb6130de18834e0a7d1dac9	\N	2026-11-24 13:20:50.404252
8b631ad3-53b0-4904-907d-7df964198907	2	5	2045	IN_STOCK	09a73f7b71a6d170efce90e729b0562ed47bf8127260e7d55fcdf823d2f9be05	\N	2026-11-24 09:39:01.006432
97877e73-1b96-4e21-beb3-8e39e4fbd58e	2	5	2045	IN_STOCK	b3cbf9caf954bb5c25da84abe5e5952c00891f53c907c1acb3f85c61001e0652	\N	2026-11-24 09:39:01.006432
bcc6c749-cc76-4391-b74b-90078a0033d0	2	5	2045	IN_STOCK	8833a4222f8df3dadd48719666e882cf64e9c73bde81902621a3675e305ad5e8	\N	2026-11-24 09:39:01.006432
bf78d09d-ca1c-4eb4-b28d-40b99dd48722	2	5	2045	IN_STOCK	abb95e49a8a27689c3b5ee365165753aa9e9309b713469e8b08e30f7e9cfd87a	\N	2026-11-24 09:39:01.006432
8a677c10-9d4c-40cf-8ca9-29f0471704f2	2	5	2045	IN_STOCK	e166a5f867ae0908d105fcd97882553170e6737f89d4d8cfe81a2f5773c845a2	\N	2026-11-24 09:39:01.006432
85446d87-d1ea-453b-a3e2-384c6e022cf2	2	5	2045	IN_STOCK	44fafa70fb3314d0c91584457b16b4e09f5e574d8f3295c942466576ac3f207f	\N	2026-11-24 09:39:01.006432
18c96499-3981-41f5-9095-9e238fa63572	2	5	2045	IN_STOCK	d9f1180858235b87f25f6a2e62e1d1e02754f96c13f94040d2b7616cd0ef0201	\N	2026-11-24 09:39:01.006432
38d21392-17d8-477d-9f67-62a063f69c00	2	5	2045	IN_STOCK	d854a57499fa0d81f4550f45e4469fb14f48ed719b9533067438b1cca8bd6725	\N	2026-11-24 09:39:01.006432
24250357-2875-43bc-b1af-86b9cb22dbce	2	5	2045	IN_STOCK	6c525137a1dfcc6ffaa017a767572a71aff51b25dd9b3869f0406864a9836c13	\N	2026-11-24 09:39:01.006432
72f9c3e8-6da0-445f-8037-95a7a4345c92	2	5	2045	IN_STOCK	db7b90d810c2f61bd1f582e14e66e1ec0ed04913d76c063a50eb71ca41fdb3c7	\N	2026-11-24 09:39:01.006432
f0d9ae69-c12d-46bf-a405-94d198bac075	2	6	2045	IN_STOCK	5e008a644434511e5d9d50a078ece474753d551a2a4d0e59dadd11f9cddf7d40	\N	2026-11-24 09:39:01.006432
983c74df-02cb-4762-834c-12e3caf70168	2	6	2045	IN_STOCK	5b02a2f2d02031c47d378581593293eac246d2f3afb2619bdd0b42ce080ebc4d	\N	2026-11-24 09:39:01.006432
c6b9f420-aa27-4ce1-9d8d-e5852f1cc77c	2	6	2045	IN_STOCK	4d178c81b85e82fc4d97193078504323124c9d4ab1a7ada7e0a820b456b67f13	\N	2026-11-24 09:39:01.006432
fe4d4c9e-fe19-47c5-9a88-992dcec9bd00	2	6	2045	IN_STOCK	b4bb126f2e0bf01669bc6cadfecb0bada14f28d35da62c5036f45ebbeac870e8	\N	2026-11-24 09:39:01.006432
cc5941df-9859-4b60-8980-a385344baa26	2	6	2045	IN_STOCK	ffdd3a8cf3d8387731e893018183f1b412ea05f4d315b3d3a6fb87b232b02716	\N	2026-11-24 09:39:01.006432
d2cc78cd-adb5-4b6e-9534-93693dccab29	2	6	2045	IN_STOCK	828f63b47248b95f1548a73c5d5751f4cc8cd435baacae468484657f6d6f9026	\N	2026-11-24 09:39:01.006432
b98ee258-803b-43dd-93c1-ccfdf7e871a7	2	6	2045	IN_STOCK	443db82832045117edf0c7328aa2c8e57bdbd434d8b8038a3128d0603dad7166	\N	2026-11-24 09:39:01.006432
ca84ad3f-2e2b-41a9-8f3d-9f62ca9954c9	2	6	2045	IN_STOCK	a381922522d218766112a4867953813a9fff1024aac3b2dfacee0dc22f50eb81	\N	2026-11-24 09:39:01.006432
8bd6b77f-216b-4ea6-9b0f-9c85e026df17	2	6	2045	IN_STOCK	dd3edf78906bae699aeaa70a85fc2753dfa048a260ec8c0d9da710112dde1975	\N	2026-11-24 09:39:01.006432
9baa3e59-998d-4381-a456-b7578a641e4e	2	6	2045	IN_STOCK	4eb21be8fa2442145a8bc2ae4021cce5cad4ee61d0cff3b97722392e1f2c212b	\N	2026-11-24 09:39:01.006432
0f816c11-2827-4f65-9c63-e358f78a17a4	3	8	2045	IN_STOCK	ab9175134d7d00b9f1de41f6127a45f040c23d34573ef6ef7ee856ed06b2a91f	\N	2026-11-24 09:40:22.179805
f42d22a6-bd5f-4b56-855f-1bee38bbf078	3	8	2045	IN_STOCK	762782ba3b3c06b6b41b40f9f254b1e78bc655d4db4fd0c20617fb29c85530a9	\N	2026-11-24 09:40:22.179805
8b30c3d7-2099-47eb-bed1-0c36ac5a0693	3	8	2045	IN_STOCK	ff8219023dd62ea2b6f20d9a95f831e05c1ad567c5467f25c3d9d14487da9b48	\N	2026-11-24 09:40:22.179805
52cd7957-1952-4b7a-aaf0-4c45677765bb	3	8	2045	IN_STOCK	b2147f056c4cdf0ff5c4f25cb77194225185c4f97fad487e5a9e9027229df70a	\N	2026-11-24 09:40:22.179805
1951996c-5ee1-487c-b84f-57c6414a128f	3	8	2045	IN_STOCK	23ad1145d207241f376915c97f3d506ee9c5bb27c6e48659f69006549b02abf6	\N	2026-11-24 09:40:22.179805
4fe9977e-0a81-48c0-9a20-3b22931a20d3	3	8	2045	IN_STOCK	396afe21d4684216a2cb3adc7ba9ab90cc1c1a090d51b936dd48805de0ac4b99	\N	2026-11-24 09:40:22.179805
39284525-d974-4a81-84fd-ae50b67ccfd6	1	1	1	IN_STOCK	7d8fabb4f3bdf3c003747eb6b28f21fff089e330089fd299372ab155ad22ed8e	\N	2026-11-24 09:38:05.512234
c6ffdf87-aa58-48c4-8109-4bbc192f85ec	1	1	1	IN_STOCK	e93f7d8ce857f861feac3d01be6daf607fcf481da8e46523b735c9fab933f52e	\N	2026-11-24 09:38:05.512234
7a118430-dae6-448b-be5b-03a1e9aa9a9b	1	1	1	IN_STOCK	9671a0b5683332832a451f8c88f88bd485b9c48a923b4b56ee68469467584b0f	\N	2026-11-24 09:38:05.512234
5a97163a-bd83-4a97-9507-7435eb944856	1	1	1	IN_STOCK	faf52107307a603156db20c222600dd5e45e39bf6655b0f1f6dc53e9d4721e41	\N	2026-11-24 09:38:05.512234
f32a0c25-e74d-484c-8426-d6a925d00fe6	1	1	1	IN_STOCK	97d6165eabcc631967c7df563d9dd46e3a7f99f97889cbb02704ff3e1160112b	\N	2026-11-24 09:38:05.512234
9d1e777e-3c7e-4cee-b4eb-6f38464bdcba	1	1	1	IN_STOCK	146cf1f92e068c54af0ecdb76fc5406427318a78c1449c74f62b72e332bc7da3	\N	2026-11-24 09:38:05.512234
61b7ff66-02c9-42a8-a641-4078f546678b	1	1	1	IN_STOCK	08efb7248860c6caefb05e057e8734173bbd828554b888a376c0e094b8031a3f	\N	2026-11-24 09:38:05.512234
0adb66a2-5500-4e8e-a69c-6595eea5205b	1	1	1	IN_STOCK	4790d771475c00200e50ff24c86acd714c6a34f1b71045a472721b8c359d913f	\N	2026-11-24 09:38:05.512234
f25b57c6-4a84-48e6-ae2a-fb5c91679f25	1	1	1	IN_STOCK	d9b4bdb53cc1fa57edaaf0cc48f0d1e38388516423871d40600de39b3f716a5a	\N	2026-11-24 09:38:05.512234
2d2a2155-01f0-43da-a6dd-7532ba5d5fd2	1	1	1	IN_STOCK	6af3b11c264e64900180010903b3abafc78f89de5c69468289204c8aff100b3d	\N	2026-11-24 09:38:05.512234
9d77c5d2-ebad-4213-9ff8-7322dcb7e825	1	1	1	IN_STOCK	d25eae3faf6692fd62171c8a8b71eaeb9ef0571421d461534110aba5686423c0	\N	2026-11-24 09:38:05.512234
e514ffd4-e438-485b-8009-8298afdce6e5	1	1	1	IN_STOCK	9c61efe2d2464082fec3bb67d59f4dd3ced7deea75cc784f49d7f567c31841d0	\N	2026-11-24 09:38:05.512234
1c7e907f-16dc-4cc8-9862-325bb89bd162	1	1	1	IN_STOCK	e101ba88a2b51804441123edf70f1e38c157ce7a3b29b5e7be57d7a300e06878	\N	2026-11-24 09:38:05.512234
01d18c76-e8a0-4251-9311-913b4749ea24	3	8	2045	IN_STOCK	a8c7443767a7432f72506404cef8749c3a87f5230fcf4c0171a5c848c803f898	\N	2026-11-24 09:40:22.179805
ef9c33c8-cf13-487d-ba0d-a0d939425294	3	8	2045	IN_STOCK	9a8aede6af670a0639b8e4ec98152e5158e04fa4c6b1938c38c2207be7aedd1a	\N	2026-11-24 09:40:22.179805
2cf75473-be06-40c1-a8ff-aeba48ea4110	3	8	2045	IN_STOCK	14caa8e62e9199b23a3944004ef03b27fb48a49e61a9f101a9820e3ab15910f3	\N	2026-11-24 09:40:22.179805
125644e4-4d86-4fa5-8dd7-08e230cfebe8	3	8	2045	IN_STOCK	7d54376c627b38234ee530bcb2cf80e9781b2302a640126794211d6fdbd784ef	\N	2026-11-24 09:40:22.179805
233551a5-6528-41c1-b6c3-12474f08731f	3	8	2045	IN_STOCK	8575d81f92e7d274b4b6bf28fecfa8d942b82ffea8a650d4546960e8ed35a061	\N	2026-11-24 09:40:22.179805
3464de1c-9135-4bd5-bce3-57e4ee4592d2	3	8	2045	IN_STOCK	6e896395471811e58dd912083d3eb025efc03b54a38c82abf8eb0b8482726887	\N	2026-11-24 09:40:22.179805
48a4c5f8-e556-4a58-92c2-b3285a59e35a	3	8	2045	IN_STOCK	6e1a6812db7d3641daaec63754f4f956034b2864c3dcf34632682ba582c79356	\N	2026-11-24 09:40:22.179805
17c63832-2377-4909-8e4b-3af2443b9906	3	8	2045	IN_STOCK	1946b2b9967ac3ca5d89a8523dd0650b521657389ec93995ff046b51512d4338	\N	2026-11-24 09:40:22.179805
026d7d0a-bfbe-4860-acab-bd4b1805c4b0	3	8	2045	IN_STOCK	2dfb7eefe59a0f962d0d82dec841276c0b2f7f8add7a992ddbffdd3f13f26ea4	\N	2026-11-24 09:40:22.179805
7afcc9f7-0c26-4471-90ec-3c56fa062716	3	8	2045	IN_STOCK	8f24489bd4a4ee0d47a8e044056693b0a125e8a5cd602016a63414a1d165bfd3	\N	2026-11-24 09:40:22.179805
c7522871-d5b0-4e6a-9e52-5ba227c26ed0	3	8	2045	IN_STOCK	8086a78ce1c7e3b2d4a1b4e7c31cd8f6a860efd00403fdccc16b0acf99ee7d8f	\N	2026-11-24 09:40:22.179805
e2f919f0-bd03-49fa-b0de-5becdf45d337	3	8	2045	IN_STOCK	dd9a329d265f1400872d6899e9203def46097cc5f714de3f22db2d9b5182961d	\N	2026-11-24 09:40:22.179805
c2617cb0-0122-406a-911e-a07f6b764439	3	8	2045	IN_STOCK	1c66201cd0da02aff70ba42ff3d71b971b2213656fb91c8169b2c3722d59000a	\N	2026-11-24 09:40:22.179805
61a262ef-d8fb-443f-9852-8d39d4868649	3	8	2045	IN_STOCK	5844908dff72789dc5d6d6c265bfa2e535324bf27640f15078a2bee664975b95	\N	2026-11-24 09:40:22.179805
32a17908-dec2-47c9-9c99-93e19fd603e1	3	9	2045	IN_STOCK	305cecb11d3c5f9f731912a0499cef4371874fe306ef616a41401e182a89cca9	\N	2026-11-24 09:40:22.179805
0cd17e3e-9669-4c29-8e1d-1c54fa1cfad2	3	9	2045	IN_STOCK	abe66a9d5e8b29df27cda9ee4cc0fa32db1beb5c30247e340893610dd6a3c1f6	\N	2026-11-24 09:40:22.179805
c54357d2-3624-4a73-adfb-d8cc08dbf5e8	3	9	2045	IN_STOCK	a8d4006460e9ff593cfea911482088337077a2da85df9b481c942b79e65341e0	\N	2026-11-24 09:40:22.179805
334bc8ca-33be-4467-81e3-0949fc740a0d	3	9	2045	IN_STOCK	c04ded4eb39b767e827fad6d01f0b3d5756a9c404e14051da2afb1068041e712	\N	2026-11-24 09:40:22.179805
0c0d7718-ebff-4a83-9ded-9917759c7ce2	3	9	2045	IN_STOCK	218c5c6b4f24f3a28148a5e22c3b430be81525152ea3e4acc6f8208fcd92caa8	\N	2026-11-24 09:40:22.179805
16ca2081-c41f-4b27-a7f2-008fd997c6a1	3	9	2045	IN_STOCK	4de16ca310832f51d008ceff6fc2e0e30e4f7831c8ff52cb65584b189401cfa6	\N	2026-11-24 09:40:22.179805
aaab1f3d-2304-41c4-97d8-9a4902a250a5	3	9	2045	IN_STOCK	b7d0d6eb74970b65779f8aed72810313b423c43034cb0c22b7b390596a7c5783	\N	2026-11-24 09:40:22.179805
327b28a5-7ed6-40e1-8d68-ece7a4823ff1	3	9	2045	IN_STOCK	27009db057c530aaa729f91f771f022b32b9ec03b496f38bfd7e9460a6260bdb	\N	2026-11-24 09:40:22.179805
2d703ff9-f296-4d39-af8e-e9bc712d4581	3	9	2045	IN_STOCK	20c4d97ca3ef1cdcd169ee1cb3c2acd2cc2e150386943942d85d700c50f6e2ee	\N	2026-11-24 09:40:22.179805
5b400cbe-d306-4033-b649-4e5b793069dd	3	9	2045	IN_STOCK	de64722a7177be9d32542534ac152492067ef0a90ac523e88e41f2f30887275b	\N	2026-11-24 09:40:22.179805
da1e2b83-9e7b-4509-a7f8-3b58605b338c	3	9	2045	IN_STOCK	3b43b3edf15712d95216faf4be215c9dc7074fa42cf69ea325895d24c8d6a89f	\N	2026-11-24 09:40:22.179805
30faf7c8-2e97-4fb7-8173-7edc01b63d17	3	9	2045	IN_STOCK	24df91d73773ff9926e18a740dc614f0529debe5fe5d9a0666f6ca82b937b1fe	\N	2026-11-24 09:40:22.179805
03bbab46-c21b-46f7-8cce-908bf2e7a4c9	3	9	2045	IN_STOCK	0412e089b77e3663977db55954fad2d01ff027d215091db51f80a0130200f6a7	\N	2026-11-24 09:40:22.179805
0b890e30-15eb-4775-9613-75bfb1284615	3	9	2045	IN_STOCK	93741761354150a5336494b8f86f9ff03c5e100d10daf5974c08af6c3f808430	\N	2026-11-24 09:40:22.179805
f6b79b5f-5907-404e-bec3-f1ea96f86956	3	9	2045	IN_STOCK	0632ee84f0e6e685d3ec2a966c7fdd8e01ed90efa617b7b32b91524e89dae241	\N	2026-11-24 09:40:22.179805
cc2cc848-33ab-4dcb-9d65-4d4f0ec55af8	3	9	2045	IN_STOCK	8718c4fb3aa8d105539333be0161134660a9d3a6aeb6e7b3c06d8f3550dea65f	\N	2026-11-24 09:40:22.179805
430458f6-5614-4536-b1fc-7cd2f3b093fa	3	9	2045	IN_STOCK	12bcb19568f4e421da6da8d7eb5a752fc68ec48ef17ea5b73ddfac47192ee140	\N	2026-11-24 09:40:22.179805
350933f2-2e4e-49f3-84e5-2cc4c513eb98	3	9	2045	IN_STOCK	95730509444b31918160e84ce8717d21c5fcd2ce6e2268e8dc31713c18e0fc36	\N	2026-11-24 09:40:22.179805
1c21ee04-926a-43e4-a6ca-20e395a2c6ff	3	9	2045	IN_STOCK	24e07966b92dfbf7c430cf872cd149e68ab98f5ac230b1d74fd75a4c18df19b3	\N	2026-11-24 09:40:22.179805
180f2005-3ea4-4562-b2f1-9c48b0a19aca	3	9	2045	IN_STOCK	994d10d640452474618d999a2edbb90fde9a5c995d8010db6ed9945abd2ed35c	\N	2026-11-24 09:40:22.179805
10c68cd9-e273-4022-a6a7-2b44f96f1808	5	\N	2046	IN_TRANSIT	de82f895778c3926e35eec64842d60da273e3bac7c8d97f7ffe19eb077d3d129	\N	2026-11-24 10:09:43.793796
5e73dcdc-5d4e-46cc-b21c-3d75ea6f615c	5	\N	2046	IN_TRANSIT	4924779d56ab8c2b1f9a3adfa378da6429f2830728ae367185b4a0598a31bf4c	\N	2026-11-24 10:09:43.793796
f108ff76-ff55-4a62-b59f-b11bd3bc9d2f	5	\N	2046	IN_TRANSIT	2e4553c4d0c29284387f59c3b959f00c19a09928a9a9e08ed5c7d29c3f88146e	\N	2026-11-24 10:09:43.793796
94087124-308f-4437-aac2-8af0c4598cd2	5	\N	2046	IN_TRANSIT	5d4fee18538b699c4dc628a41051e876413180aeeef553e47bf5a1c13f860c98	\N	2026-11-24 10:09:43.793796
1bb13b53-b01b-4d27-a9dd-39c1dae1015d	5	\N	2046	IN_TRANSIT	90e59900eb1748f36e8d7041a26b22f8b266b6fb519d19aae8c58d50de1b3403	\N	2026-11-24 10:09:43.793796
cfc8556e-74f3-403c-b910-236301381bf1	4	10	2045	QUARANTINED	242d1c252b47c1bef6015fbe2203037543cdbd9c1b9b821f2a349c75f7acae00	\N	2026-11-24 09:40:56.250437
33c7d775-0a0e-46f9-b2a1-8ba64c7f2e6b	4	10	2045	QUARANTINED	d9b8e1a7a534911bd698913e0f60ab7fd30c88812a8d94544cf43222c6c12ee2	\N	2026-11-24 09:40:56.250437
4e6daa83-de84-4943-92f2-86ddd31c0d49	4	10	2045	QUARANTINED	1ddf2e0d8b5c6e26f29ba057e0ae922833b59a026095779668592f4c4a257d91	\N	2026-11-24 09:40:56.250437
7142d432-6b02-4072-9ab2-13a555dbeb5b	4	10	2045	QUARANTINED	b6ec60397ade7300cfa7e1baf0a89cb5b2ac900949a3666f26108a37e72a79e4	\N	2026-11-24 09:40:56.250437
360dd154-8eba-4071-8170-4d031ff9ffbc	4	10	2045	QUARANTINED	16048eaea1f352342655051daf06803148c9dbf6064082e2c22e122a2bafebaa	\N	2026-11-24 09:40:56.250437
987bf5ff-7156-4c70-9243-5e27d8eec340	5	\N	2046	IN_TRANSIT	18c2c38c26ad2bd9067b7ded9a9d55960bb8bdfbeba52f86b6c2ff01d267fc6c	\N	2026-11-24 10:09:43.793796
04b28435-8c48-47cd-b2c3-5f672457eee4	5	\N	2046	IN_TRANSIT	2902fa7b2d0e9fdfd983d82e3b283c21a0aebca18be5cb2184dcff13d51d513f	\N	2026-11-24 10:09:43.793796
2214d0f3-4019-474a-92f9-704355396a62	5	\N	2046	IN_TRANSIT	2b48ab5c19fa8f8ecd3e59c48f8a2ac9e2de556e0c990c8bcf9d3b2e0657c3b0	\N	2026-11-24 10:09:43.793796
29503f86-a2ef-45d2-864a-18a9e43e37c0	5	\N	2046	IN_TRANSIT	65c3c989255107fb74b72554102e0138ca9926807d2974b311d18aac07f7115c	\N	2026-11-24 10:09:43.793796
2abdacb4-d713-4555-a823-d884612ba85e	1	2	2046	IN_STOCK	2ee16053835b256f854272a2dd96e0000217ad9ca841d31b3860187dd186ccfb	\N	2026-11-24 09:38:05.512234
527f5ea9-a0c9-4da4-b0d8-26c4291a9754	1	2	2046	IN_STOCK	6d5a3a607a43d8fff5687e1568f15fde0de0f96ae4cc092c69fc2608096b051e	\N	2026-11-24 09:38:05.512234
c8f579d0-dba8-4ae4-8650-8ee87a1e9a9d	1	2	2046	IN_STOCK	673a60c4c4c50bc70d5b13447ea8446fbbe2c1d345be73d836aa55cdc936cdd9	\N	2026-11-24 09:38:05.512234
a4253d92-fd3b-40cd-95ef-5da805d736ee	1	2	2046	IN_STOCK	3a609139428cedb6b4aac482f237834a1dcec5d0c21e5e67f9c565f183a2a573	\N	2026-11-24 09:38:05.512234
3803b476-baf5-45c1-a045-1800af7cff5a	1	2	2046	IN_STOCK	28807d2696e7d3f1667f5d0f54a3d2bbb41e6ba37ef2384ce57d28341a66dc94	\N	2026-11-24 09:38:05.512234
e78c1e5b-4aaf-47c7-82c3-9f5b44ed2bda	1	2	2046	IN_TRANSIT	b0874d91c6bc75a62042cb0af657337406d7bbda666f3e03b33aca17d3cfbced	\N	2026-11-24 09:38:05.512234
986e40a9-ad42-4e13-b702-39c523ab04ee	1	2	2046	IN_TRANSIT	5456a71f17d426971b0dd255df884c21883673a4eb60edb2a3a4c09ce3655d75	\N	2026-11-24 09:38:05.512234
630d2bb4-5cee-439c-a846-bd0726aaa890	1	2	2046	IN_TRANSIT	9f8e366fb8bc84f79a5e5555503f4fb84b2fa9c296728ecb7d557dc5b3f91a6c	\N	2026-11-24 09:38:05.512234
622a4974-2b81-4d29-8ee2-bbd07b91651a	1	2	2046	IN_TRANSIT	d0947e98a8cea339171d310627901c3051a6895d67071699fa9f592236a6c4ab	\N	2026-11-24 09:38:05.512234
b4e4cf49-972b-49e6-9d4b-abbd0e0bf5dc	1	2	2046	IN_TRANSIT	e8b71ecf5aa2400f9b354f375b29fc5a7d0f043be81c620c5ee868f29aff10d2	\N	2026-11-24 09:38:05.512234
1106d01f-ae15-427d-a36a-8299b321754a	1	2	2046	IN_STOCK	1e86cc1d1b1b3585250f52a03618bbe2953bc85af749f8e228d2c7333cc67264	\N	2026-11-24 09:38:05.512234
398b5aa0-12ae-450e-81d2-94f5a01949a0	1	2	2046	IN_STOCK	86bb3d86d27d3ed3bbe6e1a5d14092b9bb417ee37e0abcccb9340488f84b536e	\N	2026-11-24 09:38:05.512234
c3f42115-9454-4ecc-8a83-662a40769ef5	1	2	2046	IN_STOCK	0cc7ed9ea596e3710c169f6760aa74c1a32dc98b16d026124e5493eeb99ec6cf	\N	2026-11-24 09:38:05.512234
db50d3c4-e2dc-4ea2-989c-47c4796490d2	1	2	2046	IN_STOCK	3cd20b108f907a28a157b7eda1a6798ddfa60f92a19cca3edd288505cecc658b	\N	2026-11-24 09:38:05.512234
8bcdfdd0-f111-4efc-9464-5deac52dd0f8	1	2	2046	IN_STOCK	23ac7a56bcfd31222a9a4338c3e4110f784a478ab7e6fa89db015693aa7fc6b4	\N	2026-11-24 09:38:05.512234
359ccd95-4e9b-46fa-8410-cae4b90ee0d9	1	2	2046	IN_STOCK	61437f6dbb846e4427b82a1632e6f1ff4ac7561eac647e98c82fd765a56aef62	\N	2026-11-24 09:38:05.512234
5ca13667-9fed-404d-b57a-75150b080ed4	1	2	2046	IN_STOCK	53a45e40f91c1f7b50d71bf12ebb3c562e503b89c6568f8235524c31e3fcd9fe	\N	2026-11-24 09:38:05.512234
d18fc531-95ef-4f1c-bf21-21281bf7b343	1	2	2046	IN_STOCK	9856e8cb3b70f96f67b98eb8af231c1b80c7c684e6f5d565d97993931e5a9f9a	\N	2026-11-24 09:38:05.512234
a350414f-3c2c-4323-bb4c-f44eae071d82	1	2	2046	IN_STOCK	6c77c2ed6c3cbeb9988874286fa75aa797255dffb8765fcb228d5f6411a4f50a	\N	2026-11-24 09:38:05.512234
1377a656-a997-46c7-8349-12cdc2557c31	1	2	2046	DAMAGED	a95dc24f0a9e5a56d60e0e8c68a20d082790ad38d2d8715fde2d5837f4d6b432	\N	2026-11-24 09:38:05.512234
28dd3368-4740-4694-83a9-995532a470ac	3	7	1	IN_STOCK	3edbbd14732788efb44ae0a7fa1228990104feaec2f0455e4f5c9801c7b157f4	\N	2026-11-24 09:40:22.179805
03a7cbe3-ba6e-482a-ba8a-27b7f82f5b46	3	7	1	PACKAGED	4951b66543f028dd6e4343a0a98903a6dcc6f0dc9b3ac6769862d85f413c1088	\N	2026-11-24 09:40:22.179805
a1b5ab1f-7354-436e-a0f2-e78018443721	1	1	1	IN_STOCK	3bdf5cf011981bed29dd86b3886d5f31e94a24520be63dcb928b27b36470ae8a	\N	2026-11-24 09:38:05.512234
af8e42fd-ef43-4104-81e2-d0939fa640e0	1	1	1	IN_STOCK	bcc043da2d09925266d83d2c1542ef1e68aa1f76b2b12c3211c7d0698a5c7441	\N	2026-11-24 09:38:05.512234
4f4c10a8-086e-4f5b-9df8-256246394032	1	1	1	IN_STOCK	49852ad9e082162e616229e4ff94ba0bcc745c44be0d6bc06c342af508395ac7	\N	2026-11-24 09:38:05.512234
beaa161d-e788-4801-82d3-c8992785d857	1	1	1	IN_STOCK	cd099c6903148663bab50b990bac47c0d2030965a3adc8b7176c77475a12d58b	\N	2026-11-24 09:38:05.512234
4d695c75-a991-4531-957f-d865d45db4ec	1	1	1	IN_STOCK	3caa880ea050e0eb76172aa75141bfc139bea18d4ea835b1e0cc11819488fa35	\N	2026-11-24 09:38:05.512234
cd3d00ac-3407-4542-8781-e3f3cf457d35	1	1	1	IN_STOCK	a009f7fbfd8f142714e7f09dcc59d8001598c4b05c0f08ccf105e39c97b48c19	\N	2026-11-24 09:38:05.512234
117e95b5-10e3-4892-98bd-a6be938aa9ac	3	7	1	IN_STOCK	5d7108bf0f116c05655ee5efc443c8a0ec60742a48a5c037934737bd62e46ed1	\N	2026-11-24 09:40:22.179805
c38adc3f-4bb1-4b82-abf8-dc877e232d21	3	7	1	IN_STOCK	16d3ef8505d16129bf86a7cdcb7fbbb940ee2c7871e2bbbd82b4cadf5e0b3475	\N	2026-11-24 09:40:22.179805
32a6ed8e-044e-4379-8583-380e9c477a85	3	7	1	IN_STOCK	6f88b93eba47ed3299009a2cac9ae398179e5f11c5cb1af06b6d20de854bc4f2	\N	2026-11-24 09:40:22.179805
602efeac-0ae7-47df-90eb-d6f55e62778c	3	7	1	IN_STOCK	8ea236c67707bd8f69d640a32196e6bbf05c056efae46ff8af5ae708a08b4350	\N	2026-11-24 09:40:22.179805
252c344b-0fe0-48cc-b638-43a784a31b61	3	7	1	IN_STOCK	4deaa33f66504081020850aa837afd5767de7c7d9cb90c2942d24c6b0d1b39ce	\N	2026-11-24 09:40:22.179805
52693654-48c5-40e1-87e7-97423110acf0	3	7	1	IN_STOCK	d8b972acc293c57753b56a1716a29e8a76e9b63cc0f9f7a7a630536ad1e4c7fb	\N	2026-11-24 09:40:22.179805
df32f9a6-bad1-43d2-874a-997facfe5568	3	7	1	IN_STOCK	faa9134469bda39c397e168eff06af317f6c945d4781d076c74aa1267c14be23	\N	2026-11-24 09:40:22.179805
2499d91e-b3be-47f5-ae57-c2b206281fce	3	7	1	IN_STOCK	a42f1bfcf186954f8ba243902b5bcff54fbc9bbe35abc314f4841d6465fad319	\N	2026-11-24 09:40:22.179805
7adbbca7-4db6-48ca-be87-8fc036b608cc	3	7	1	IN_STOCK	50d1b4e640d5f487f5a32f4cf5ea5b48fcc4648d0208259b7f4e5c76362cdbf7	\N	2026-11-24 09:40:22.179805
61d99a2c-4851-4f02-8045-4ff7f00c2f51	3	7	1	IN_STOCK	938fecff4ffd9f81c3add23b8fa6d66c79f0577f55c64aa22ec09611019ae6a9	\N	2026-11-24 09:40:22.179805
3fb196f7-a8d2-43e3-b36a-1beb905849d7	3	7	1	IN_STOCK	902794ea3554043094a2e1fb72fb54a69e9fa29fe3186879ea9ff6fd925aaf8d	\N	2026-11-24 09:40:22.179805
d714574d-22df-4d2c-b9c9-9a6c02f5f4b2	3	7	1	IN_STOCK	e960cd3023774420bef27e17790549dd3594afaea8c1115cc075c56c79ef6591	\N	2026-11-24 09:40:22.179805
74b7af20-05d0-4e21-8a06-d8f2f42797e8	3	7	1	IN_STOCK	25536d7a07bee376050fb788177abe40572b3b7c39cef8a8af569e0046bf8c16	\N	2026-11-24 09:40:22.179805
be20cd02-2cc8-466f-afcd-17626269266e	3	7	1	IN_STOCK	3e301c17ccdac57c2764eee42542b43ac49c597af64bcce18b868893048cbe7c	\N	2026-11-24 09:40:22.179805
0d209da7-25a0-4273-b992-12e1792227a6	3	7	1	IN_STOCK	10d954923b33440d589d64495a6299dacc1b11f08220da751597cfe47f819f2a	\N	2026-11-24 09:40:22.179805
16e4697d-7c90-4831-a9f8-5e877c90955a	3	7	1	IN_STOCK	3704effa32d2361f8f76614a973d54404f7026f75ff07210f161ee28862009ff	\N	2026-11-24 09:40:22.179805
61a621f9-2da6-4bcf-9555-9ddb0af2cdf4	3	7	1	IN_STOCK	7cd8321a335b79d9dc7d44e40d660b6961ba61a11ceb2cc2d2f18280fadc7536	\N	2026-11-24 09:40:22.179805
0eee645d-7348-4302-b3c1-769d30bce2f5	3	7	1	IN_STOCK	097ed86858860e261b223c1bebb4342f86a1cb947676c0c4b8b45227fed9077e	\N	2026-11-24 09:40:22.179805
\.

COPY public.moderation_audit_logs (id, review_id, action, performed_by_employee_id, performed_by_customer_id, performed_by_role, reason, meta, created_at) FROM stdin;
1	\N	AUTO_APPROVE	\N	17	CUSTOMER	Automated moderation check passed	{"flags": [], "status": "APPROVED", "reviewId": 1, "riskScore": 0}	2026-11-24 12:58:55.593877+00
2	\N	CUSTOMER_EDIT	\N	17	CUSTOMER	Review edited by author customer	{"flags": [], "reviewId": 1, "riskScore": 0}	2026-11-24 12:59:11.647078+00
3	\N	CUSTOMER_DELETE	\N	17	CUSTOMER	Customer deleted their own review	{"reviewId": 1}	2026-11-24 12:59:13.288551+00
4	2	AUTO_APPROVE	\N	17	CUSTOMER	Automated moderation check passed	{"flags": [], "status": "APPROVED", "reviewId": 2, "riskScore": 0}	2026-11-24 13:02:52.009371+00
5	2	ADMIN_STATUS_SPAM	11	\N	SUPER_ADMIN	Status updated from APPROVED to SPAM	{"reviewId": 2, "newStatus": "SPAM", "previousStatus": "APPROVED"}	2026-11-24 13:03:52.863949+00
6	2	ADMIN_STATUS_APPROVED	11	\N	SUPER_ADMIN	Status updated from SPAM to APPROVED	{"reviewId": 2, "newStatus": "APPROVED", "previousStatus": "SPAM"}	2026-11-24 13:04:38.547606+00
7	2	USER_REPORT	\N	18	CUSTOMER	Reported by user as SPAM: Looks like promotional spam	{"reason": "SPAM", "reportId": 1, "reviewId": 2, "description": "Looks like promotional spam"}	2026-11-24 13:06:20.461616+00
8	2	RESOLVE_REPORT	11	\N	SUPER_ADMIN	Report resolved	{"reportId": 1, "reviewId": 2, "actionOnReview": "SPAM"}	2026-11-24 13:06:37.679501+00
9	2	ADMIN_STATUS_APPROVED	11	\N	SUPER_ADMIN	Status updated from SPAM to APPROVED	{"reviewId": 2, "newStatus": "APPROVED", "previousStatus": "SPAM"}	2026-11-24 13:09:10.98052+00
10	2	ADMIN_STATUS_SPAM	11	\N	SUPER_ADMIN	Status updated from APPROVED to SPAM	{"reviewId": 2, "newStatus": "SPAM", "previousStatus": "APPROVED"}	2026-11-24 13:09:15.455416+00
\.

COPY public.moderation_reports (id, review_id, reporter_customer_id, reporter_employee_id, reason, description, status, resolved_by_employee_id, resolver_note, created_at, resolved_at) FROM stdin;
1	2	18	\N	SPAM	Looks like promotional spam	RESOLVED	11	Resolved by SuperAdmin	2026-11-24 13:06:20.476+00	2026-11-24 13:06:37.691+00
\.

COPY public.order_cancellation_reasons (order_id, customer_id, reason_code, reason_details, created_at) FROM stdin;
3	17	OTHER	Ordered wrong quantity or item	2026-11-24 11:16:20.254319+00
4	17	CHANGED_MIND	\N	2026-11-24 11:19:35.459746+00
\.

COPY public.order_fulfillment_terms (order_id, selling_facility_id, policy, transport_requirements, accepted_at) FROM stdin;
1	1	{"enabled": true, "weekdays": [0, 1, 2, 3, 4, 5, 6], "radius_km": 100, "updated_at": "2026-11-24T09:14:17.534649+00:00", "updated_by": 12, "facility_id": 1, "opens_minute": 0, "closes_minute": 1440, "daily_capacity": 1000, "selling_facility_id": 1, "transport_conditions": ["APPROVED_STANDARD"]}	[{"condition": "APPROVED_STANDARD", "updated_at": "2026-11-09T17:57:44.559912+00:00", "updated_by": 11, "medicine_id": 9}]	2026-11-24 11:12:45.421729+00
2	1	{"enabled": true, "weekdays": [0, 1, 2, 3, 4, 5, 6], "radius_km": 100, "updated_at": "2026-11-24T09:14:17.534649+00:00", "updated_by": 12, "facility_id": 1, "opens_minute": 0, "closes_minute": 1440, "daily_capacity": 1000, "selling_facility_id": 1, "transport_conditions": ["APPROVED_STANDARD"]}	[{"condition": "APPROVED_STANDARD", "updated_at": "2026-11-09T17:57:44.559912+00:00", "updated_by": 11, "medicine_id": 1797}]	2026-11-24 11:14:26.357994+00
3	1	{"enabled": true, "weekdays": [0, 1, 2, 3, 4, 5, 6], "radius_km": 100, "updated_at": "2026-11-24T09:14:17.534649+00:00", "updated_by": 12, "facility_id": 1, "opens_minute": 0, "closes_minute": 1440, "daily_capacity": 1000, "selling_facility_id": 1, "transport_conditions": ["APPROVED_STANDARD"]}	[{"condition": "APPROVED_STANDARD", "updated_at": "2026-11-09T17:57:44.559912+00:00", "updated_by": 11, "medicine_id": 9}]	2026-11-24 11:15:52.258589+00
4	1	{"enabled": true, "weekdays": [0, 1, 2, 3, 4, 5, 6], "radius_km": 100, "updated_at": "2026-11-24T09:14:17.534649+00:00", "updated_by": 12, "facility_id": 1, "opens_minute": 0, "closes_minute": 1440, "daily_capacity": 1000, "selling_facility_id": 1, "transport_conditions": ["APPROVED_STANDARD"]}	[{"condition": "APPROVED_STANDARD", "updated_at": "2026-11-09T17:57:44.559912+00:00", "updated_by": 11, "medicine_id": 9}]	2026-11-24 11:18:02.118448+00
5	1	{"enabled": true, "weekdays": [0, 1, 2, 3, 4, 5, 6], "radius_km": 100, "updated_at": "2026-11-24T09:14:17.534649+00:00", "updated_by": 12, "facility_id": 1, "opens_minute": 0, "closes_minute": 1440, "daily_capacity": 1000, "selling_facility_id": 1, "transport_conditions": ["APPROVED_STANDARD"]}	[{"condition": "APPROVED_STANDARD", "updated_at": "2026-11-09T17:57:44.559912+00:00", "updated_by": 11, "medicine_id": 9}]	2026-11-24 11:23:31.746352+00
6	1	{"enabled": true, "weekdays": [0, 1, 2, 3, 4, 5, 6], "radius_km": 100, "updated_at": "2026-11-09T17:57:44.559912+00:00", "updated_by": 11, "facility_id": 2046, "opens_minute": 0, "closes_minute": 1440, "daily_capacity": 1000, "selling_facility_id": 1, "transport_conditions": ["APPROVED_STANDARD"]}	[{"condition": "APPROVED_STANDARD", "updated_at": "2026-11-09T17:57:44.559912+00:00", "updated_by": 11, "medicine_id": 9}]	2026-11-24 12:27:27.481992+00
\.

COPY public.order_items (id, order_id, medicine_id, variant_id, quantity, unit_price, total_price, assigned_uids, medicine_name, unit_name, inventory_reserved, source_facility_id) FROM stdin;
3	3	9	11	7	15000.00	105000.00	{}	Panadol Extra Red Tablets 500mg/65mg for Pain Relief and Fever Reduction (15 Blisters x 12 Tablets)	Blister Pack	f	1
4	4	9	11	7	15000.00	105000.00	{}	Panadol Extra Red Tablets 500mg/65mg for Pain Relief and Fever Reduction (15 Blisters x 12 Tablets)	Blister Pack	f	1
5	5	9	11	7	15000.00	105000.00	{}	Panadol Extra Red Tablets 500mg/65mg for Pain Relief and Fever Reduction (15 Blisters x 12 Tablets)	Blister Pack	f	1
2	2	1797	822	1	101818.00	101818.00	{03a7cbe3-ba6e-482a-ba8a-27b7f82f5b46}	Comiaryl 2mg/500mg Tablets for Type 2 Diabetes Mellitus (3 Blisters x 10 Tablets)	Box	f	1
1	1	9	11	1	15000.00	15000.00	{00d3d676-808d-4e7d-90be-24fcaf4914aa}	Panadol Extra Red Tablets 500mg/65mg for Pain Relief and Fever Reduction (15 Blisters x 12 Tablets)	Blister Pack	f	1
6	6	9	11	25	20000.00	500000.00	{1df14bd6-e9c3-431d-90c5-bf702f343d55,7cb84802-3826-423e-a026-4e74bf4e0de3,a82b0fd8-c05f-4972-8a14-89d04062ee21,d060090a-db1d-43f7-bca0-e32fa89b8900,9453bbdc-4dc7-44a3-9acf-c3edfbb95306,b3c378a8-848c-45ef-b0ef-c7c2526789b4,b651621c-14a1-4b7f-8e9e-173fb64e3158,08522e76-26fe-4605-b8b5-c11fbb3be573,0da596b3-c5b5-409f-96a4-f999a90b8774,85a39f1e-2190-4192-9cbc-faba709adf30,d686ceeb-3292-462b-b388-5de12c3e2a64,f108ff76-ff55-4a62-b59f-b11bd3bc9d2f,5e73dcdc-5d4e-46cc-b21c-3d75ea6f615c,04b28435-8c48-47cd-b2c3-5f672457eee4,29503f86-a2ef-45d2-864a-18a9e43e37c0,987bf5ff-7156-4c70-9243-5e27d8eec340,2214d0f3-4019-474a-92f9-704355396a62,1bb13b53-b01b-4d27-a9dd-39c1dae1015d,10c68cd9-e273-4022-a6a7-2b44f96f1808,94087124-308f-4437-aac2-8af0c4598cd2,622a4974-2b81-4d29-8ee2-bbd07b91651a,630d2bb4-5cee-439c-a846-bd0726aaa890,e78c1e5b-4aaf-47c7-82c3-9f5b44ed2bda,b4e4cf49-972b-49e6-9d4b-abbd0e0bf5dc,986e40a9-ad42-4e13-b702-39c523ab04ee}	Panadol Extra Red Tablets 500mg/65mg for Pain Relief and Fever Reduction (15 Blisters x 12 Tablets)	Blister Pack	f	2046
\.

COPY public.order_package_items (id, package_id, order_item_id, box_uid, voided_at) FROM stdin;
1	1	2	03a7cbe3-ba6e-482a-ba8a-27b7f82f5b46	\N
2	2	1	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N
3	3	6	1df14bd6-e9c3-431d-90c5-bf702f343d55	\N
4	3	6	85a39f1e-2190-4192-9cbc-faba709adf30	\N
5	3	6	0da596b3-c5b5-409f-96a4-f999a90b8774	\N
6	3	6	08522e76-26fe-4605-b8b5-c11fbb3be573	\N
7	3	6	b651621c-14a1-4b7f-8e9e-173fb64e3158	\N
8	3	6	b3c378a8-848c-45ef-b0ef-c7c2526789b4	\N
9	3	6	9453bbdc-4dc7-44a3-9acf-c3edfbb95306	\N
10	3	6	d060090a-db1d-43f7-bca0-e32fa89b8900	\N
11	3	6	a82b0fd8-c05f-4972-8a14-89d04062ee21	\N
12	3	6	7cb84802-3826-423e-a026-4e74bf4e0de3	\N
13	3	6	94087124-308f-4437-aac2-8af0c4598cd2	\N
14	3	6	d686ceeb-3292-462b-b388-5de12c3e2a64	\N
15	3	6	f108ff76-ff55-4a62-b59f-b11bd3bc9d2f	\N
16	3	6	5e73dcdc-5d4e-46cc-b21c-3d75ea6f615c	\N
17	3	6	04b28435-8c48-47cd-b2c3-5f672457eee4	\N
18	3	6	29503f86-a2ef-45d2-864a-18a9e43e37c0	\N
19	3	6	987bf5ff-7156-4c70-9243-5e27d8eec340	\N
20	3	6	2214d0f3-4019-474a-92f9-704355396a62	\N
21	3	6	1bb13b53-b01b-4d27-a9dd-39c1dae1015d	\N
22	3	6	10c68cd9-e273-4022-a6a7-2b44f96f1808	\N
23	3	6	630d2bb4-5cee-439c-a846-bd0726aaa890	\N
24	3	6	e78c1e5b-4aaf-47c7-82c3-9f5b44ed2bda	\N
25	3	6	b4e4cf49-972b-49e6-9d4b-abbd0e0bf5dc	\N
26	3	6	986e40a9-ad42-4e13-b702-39c523ab04ee	\N
27	3	6	622a4974-2b81-4d29-8ee2-bbd07b91651a	\N
\.

COPY public.order_packages (id, package_code, order_id, facility_id, status, weight_g, dimensions, packed_by_id, packed_at, void_reason, voided_by_id, voided_at) FROM stdin;
1	ORD-261124-AD442170-PKG	2	1	PACKED	\N	\N	13	2026-11-24 12:09:40.134+00	\N	\N	\N
2	ORD-261124-A38BEC4E-PKG	1	1	PACKED	\N	\N	13	2026-11-24 12:12:03.991+00	\N	\N	\N
3	PKG-20261124-29FA75	6	2046	HANDED_OVER	\N	\N	14	2026-11-24 12:30:03.956+00	\N	\N	\N
\.

COPY public.order_prescription_reviews (id, order_id, prescription_id, status, pharmacist_id, facility_id, note, reviewed_at, created_at) FROM stdin;
1	2	1	APPROVED	13	1	\N	2026-11-24 12:08:55.338+00	2026-11-24 11:14:26.379+00
\.

COPY public.orders (id, order_code, customer_id, export_facility_id, prescription_id, subtotal_amount, shipping_fee, discount_amount, used_points, total_amount, payment_method, payment_status, order_status, shipping_address, recipient_phone, recipient_name, note, created_at, prescription_review_status, voucher_id) FROM stdin;
3	ORD-261124-52418619	17	1	\N	105000.00	35000.00	20000.00	0	120000.00	COD	UNPAID	CANCELLED	12 Nguyen Hue, Ben Nghe Ward, District 1, Ho Chi Minh City	0900000017	Demo customer 17	\N	2026-11-24 11:15:52.269	\N	2
4	ORD-261124-E7CB8944	17	1	\N	105000.00	15000.00	10500.00	0	109500.00	BANK_TRANSFER	UNPAID	CANCELLED	Near Vincom Plaza Thu Duc, Ho Chi Minh City	0900000017	Demo customer 17	\N	2026-11-24 11:18:02.133	\N	1
5	ORD-261124-AC99ADA0	17	1	\N	105000.00	15000.00	10000.00	0	110000.00	BANK_TRANSFER	UNPAID	CANCELLED	[216] Vincom Plaza Thủ Đức, TP. Hồ Chí Minh	0900000017	Demo customer 17	Payment expired	2026-11-24 11:23:31.758	\N	4
6	ORD-261124-8C540BB8	17	2046	\N	500000.00	0.00	0.00	0	500000.00	COD	UNPAID	PICKED_UP	[216] Vincom Plaza Thủ Đức, TP. Hồ Chí Minh	0900000017	Demo customer 17	\N	2026-11-24 12:27:27.489	\N	\N
2	ORD-261124-AD442170	17	1	1	101818.00	35000.00	0.00	0	136818.00	COD	PAID	COMPLETED	12 Nguyen Hue, Ben Nghe Ward, District 1, Ho Chi Minh City	0900000017	Demo customer 17	\N	2026-11-24 11:14:26.364	APPROVED	\N
1	ORD-261124-A38BEC4E	17	1	\N	15000.00	35000.00	0.00	0	50000.00	COD	REFUNDED	COMPLETED	12 Nguyen Hue, Ben Nghe Ward, District 1, Ho Chi Minh City	0900000017	Demo customer 17	\N	2026-11-24 11:12:45.43	\N	\N
\.

COPY public.prescriptions (id, customer_id, prescribing_doctor, medical_facility, diagnosis, prescription_image_url, status, pharmacist_note, approved_by_pharmacist_id, prescribed_date, created_at) FROM stdin;
1	17	\N	\N	\N	cloudinary:pharmatrace/prescriptions/sqfvqfsnnr3getqpu2dq	PENDING_APPROVAL	\N	\N	\N	2026-11-24 11:13:43.9
\.

COPY public.purchase_order_events (id, po_id, action, from_status, to_status, actor_id, note, created_at) FROM stdin;
1	1	CREATED	\N	PENDING	39	\N	2026-11-24 10:05:33.671+00
2	1	APPROVED	PENDING	APPROVED	39	\N	2026-11-24 10:05:39.751+00
3	2	CREATED	\N	PENDING	39	\N	2026-11-24 10:07:42.056+00
4	2	APPROVED	PENDING	APPROVED	39	\N	2026-11-24 10:07:45.475+00
5	2	SHIPPED	APPROVED	SHIPPED	15	ship PO	2026-11-24 10:08:09.529384+00
6	2	GOODS_RECEIVED	SHIPPED	RECEIVED	39	Receipt GR-20261124-005757	2026-11-24 10:08:23.147906+00
7	1	GOODS_RECEIVED	APPROVED	RECEIVED	39	Receipt GR-20261124-43FAAF	2026-11-24 10:09:43.793796+00
\.

COPY public.purchase_order_items (id, po_id, medicine_id, batch_id, variant_id, quantity, unit_price, received_quantity) FROM stdin;
2	2	9	\N	11	10	5000.00	10
1	1	9	\N	11	10	5000.00	10
\.

COPY public.purchase_orders (id, po_code, supplier_id, created_by_employee_id, total_amount, status, note, received_at, created_at, facility_id, supplier_manufacturer_id, approved_by_id, approved_at, cancel_reason, closed_reason, expected_at, rejected_reason) FROM stdin;
2	PO-20261124-F8EAB6	2045	39	50000.00	RECEIVED	Restock order for demo stock	2026-11-24 10:08:23.147906+00	2026-11-24 10:07:42.036+00	2046	\N	39	2026-11-24 10:07:45.472+00	\N	\N	2026-11-25	\N
1	PO-20261124-32DB1B	\N	39	50000.00	RECEIVED	Restock order for demo stock	2026-11-24 10:09:43.793796+00	2026-11-24 10:05:33.644+00	2046	236	39	2026-11-24 10:05:39.746+00	\N	\N	2026-11-24	\N
\.

COPY public.qr_scan_logs (id, uid, scanned_by_user_id, latitude, longitude, ip_address, user_agent, scanned_at, scan_result, risk_score) FROM stdin;
1	03a7cbe3-ba6e-482a-ba8a-27b7f82f5b46	\N	\N	\N	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 12:49:24.990606	VALID	0
2	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	10.7725000	106.6980000	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 12:49:40.715531	VALID	0
3	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	10.7725000	106.6980000	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 13:14:35.457886	VALID	0
4	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	\N	\N	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 13:16:10.586725	VALID	0
5	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	10.7725000	106.6980000	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 13:16:17.575998	VALID	0
6	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	10.7725000	106.6980000	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 13:16:22.404893	VALID	0
7	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	10.7725000	106.6980000	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 13:16:27.310333	VALID	0
8	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	10.7725000	106.6980000	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 13:16:31.854904	VALID	0
9	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	10.7725000	106.6980000	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 13:16:35.78561	VALID	0
10	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	10.7725000	106.6980000	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 13:16:39.654234	VALID	0
11	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	10.7725000	106.6980000	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 13:16:43.149507	VALID	0
12	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	10.7725000	106.6980000	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 13:16:53.80099	VALID	0
13	00d3d676-808d-4e7d-90be-24fcaf4914aa	\N	\N	\N	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 13:24:59.575435	FLAGGED	100
14	05b07c94-6d47-4ff8-9a88-70ea9c1e6f30	\N	10.7725000	106.6980000	::ffff:172.21.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36	2026-11-24 13:25:07.529135	VALID	0
\.

COPY public.quarantine_balances (facility_id, variant_id, quantity) FROM stdin;
1	11	0
2046	11	1
2045	11	5
\.

COPY public.quarantine_movements (origin_type, origin_id, variant_id, action, inventory_log_id) FROM stdin;
RECALL	2	11	IN	6
TRANSFER	2	11	IN	12
RMA	1	11	IN	29
RMA	1	11	RESTOCK	30
RECALL	4	11	IN	37
RECALL	5	11	IN	39
RECALL	6	11	COLLECT	41
RECALL	7	11	IN	46
\.

COPY public.return_request_events (id, request_id, action, from_status, to_status, actor_type, actor_id, actor_role, actor_name, facility_id, note, created_at) FROM stdin;
1	1	CREATED	\N	REQUESTED	customer	17	CUSTOMER	Demo customer 17	\N	\N	2026-11-24 12:47:29.979076+00
2	1	APPROVED	REQUESTED	APPROVED	employee	12	STORE_MANAGER	Store Manager	1	\N	2026-11-24 12:48:00.733372+00
3	1	RECEIVED	APPROVED	RECEIVED	employee	12	STORE_MANAGER	Store Manager	1	Goods received and moved to quarantine for inspection	2026-11-24 12:54:35.596422+00
4	1	INSPECTED	RECEIVED	INSPECTED	employee	12	STORE_MANAGER	Store Manager	1	\N	2026-11-24 12:54:43.426257+00
5	1	REFUND_APPROVED	INSPECTED	REFUND_APPROVED	employee	12	STORE_MANAGER	Store Manager	1	Refund of 15000.00 approved via CASH: ok	2026-11-24 12:56:12.106853+00
6	1	REFUNDED	REFUND_APPROVED	REFUNDED	employee	12	STORE_MANAGER	Store Manager	1	Refund of 15000.00 paid, reference PC-20261124-001, cashbook #3	2026-11-24 12:56:54.126581+00
\.

COPY public.return_request_lines (request_id, order_item_id, variant_id, quantity, reason_code, restricted, exchange_variant_id, approved_quantity, received_quantity, box_uids, pass_quantity, fail_quantity, reason_note, mismatch_quantity) FROM stdin;
1	1	11	1	WRONG_ITEM	f	\N	1	1	{00d3d676-808d-4e7d-90be-24fcaf4914aa}	1	0	\N	0
\.

COPY public.return_request_refunds (request_id, goods_value, customer_fee, refund_amount, payment_method, payment_reference, reason, approved_by, approved_at, executed_by, executed_at, cashbook_id) FROM stdin;
1	15000.00	0.00	15000.00	CASH	PC-20261124-001	ok	12	2026-11-24 12:56:12.106853+00	12	2026-11-24 12:56:54.126581+00	3
\.

COPY public.return_requests (id, code, order_id, customer_id, facility_id, channel, resolution, return_method, status, description, pickup_address, customer_fee, courier_name, tracking_number, staff_note, replacement_order_id, created_at, updated_at) FROM stdin;
1	RMA-261124-F342BB	1	17	1	ONLINE	REFUND	CARRIER_PICKUP	REFUNDED	\N	12 Nguyen Hue, Ben Nghe Ward, District 1, Ho Chi Minh City	0.00	\N	\N	\N	\N	2026-11-24 12:47:30.029+00	2026-11-24 12:56:54.126581+00
\.

COPY public.reviews (id, customer_id, medicine_id, rating_stars, comment, images, created_at, status, is_verified_purchase, helpful_count, admin_reply, replied_at, replied_by_name) FROM stdin;
2	17	1797	5	Works well, delivery was fast.	{}	2026-11-24 13:02:52.02	SPAM	t	0	\N	\N	\N
\.

COPY public.shipments (id, order_id, tracking_number, courier_name, shipping_status, picked_up_at, estimated_delivery_at, actual_delivery_at, cod_amount, cod_settlement_status, cod_settled_at, note, created_at, updated_at, carrier_confirmed_at, proof_type, proof_reference, delivered_to_name, delivery_notes, return_category, return_reason, return_qa_status, return_qa_notes, return_disposition, return_received_at, return_disposed_at) FROM stdin;
3	6	GHN-ORD-261124-8C540BB8	GHN	PICKED_UP	2026-11-24 12:32:20.573721	\N	\N	500000.00	UNSETTLED	\N	\N	2026-11-24 12:30:12.344	2026-11-24 12:32:20.573721	2026-11-24 12:31:55.608+00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
2	1	GHN-ORD-261124-A38BEC4E	GHN	DELIVERED	2026-11-24 12:13:04.272	\N	2026-11-24 12:13:21.078346	50000.00	SETTLED	2026-11-24 12:39:29.327598	\N	2026-11-24 12:12:03.958	2026-11-24 12:39:29.327598	2026-11-24 12:13:01.768+00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
1	2	GHTK-261124-AD4421	GHTK	DELIVERED	2026-11-24 12:10:41	\N	2026-11-24 12:11:18.090524	136818.00	SETTLED	2026-11-24 12:41:40.762979	\N	2026-11-24 12:09:40.098	2026-11-24 12:41:40.762979	2026-11-24 12:10:18.402+00	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
\.

COPY public.sscc_cartons (id, sscc_code, batch_id, current_facility_id, status, box_count, created_at) FROM stdin;
3	231440964235309098	1	2045	PACKAGED	20	2026-11-24 09:38:05.512234
5	591773487986186843	2	2045	PACKAGED	10	2026-11-24 09:39:01.006432
6	724891377758925695	2	2045	PACKAGED	10	2026-11-24 09:39:01.006432
8	530466081959767705	3	2045	PACKAGED	20	2026-11-24 09:40:22.179805
9	510023334235807437	3	2045	PACKAGED	20	2026-11-24 09:40:22.179805
10	711113286236770988	4	2045	PACKAGED	5	2026-11-24 09:40:56.250437
2	657530584001185765	1	2046	PACKAGED	20	2026-11-24 09:38:05.512234
4	496387507276395450	2	2046	PACKAGED	10	2026-11-24 09:39:01.006432
1	703309739469056096	1	1	PACKAGED	20	2026-11-24 09:38:05.512234
7	076264688126538730	3	1	PACKAGED	20	2026-11-24 09:40:22.179805
12	822797689536596156	6	2045	PACKAGED	5	2026-11-24 13:20:50.404252
11	228703240667734131	6	2045	PACKAGED	5	2026-11-24 13:20:50.404252
\.

COPY public.stock_transfer_request_events (id, request_id, action, from_status, to_status, actor_id, note, created_at) FROM stdin;
1	1	CREATE	\N	REQUESTED	39	\N	2026-11-24 09:44:46.522205+00
2	1	APPROVE	REQUESTED	APPROVED	15	ok	2026-11-24 09:45:26.519736+00
3	2	CREATE	\N	REQUESTED	39	Request cancelled by requester	2026-11-24 09:47:01.299124+00
4	2	REJECT	REQUESTED	REJECTED	15	Quantity exceeds current demand	2026-11-24 09:47:44.751168+00
5	3	CREATE	\N	REQUESTED	15	\N	2026-11-24 09:58:46.748842+00
6	3	APPROVE	REQUESTED	APPROVED	15	\N	2026-11-24 09:58:46.748842+00
7	4	CREATE	\N	REQUESTED	39	\N	2026-11-24 10:13:34.810981+00
8	4	APPROVE	REQUESTED	APPROVED	15	\N	2026-11-24 10:14:05.691221+00
9	5	CREATE	\N	REQUESTED	12	\N	2026-11-24 10:15:39.77105+00
10	5	APPROVE	REQUESTED	APPROVED	39	\N	2026-11-24 10:15:46.718018+00
11	6	CREATE	\N	REQUESTED	39	\N	2026-11-24 13:21:43.075505+00
12	6	APPROVE	REQUESTED	APPROVED	15	\N	2026-11-24 13:21:51.404092+00
\.

COPY public.stock_transfer_requests (id, request_code, from_facility_id, to_facility_id, lines, status, reason, requested_by, decided_by, decided_at, decision_note, created_at) FROM stdin;
1	STQ-20261124-EBDAB3	2045	2046	[{"quantity": 20, "unitName": "Blister Pack", "variantId": 11, "medicineId": 9}]	APPROVED	\N	39	15	2026-11-24 09:45:26.519736+00	ok	2026-11-24 09:44:46.522205+00
2	STQ-20261124-9E477B	2045	2046	[{"quantity": 20, "unitName": "Blister Pack", "variantId": 11, "medicineId": 9}]	REJECTED	Request cancelled by requester	39	15	2026-11-24 09:47:44.751168+00	Quantity exceeds current demand	2026-11-24 09:47:01.299124+00
3	STQ-20261124-C1030B	2045	2046	[{"quantity": 20, "unitName": "Blister Pack", "variantId": 11, "medicineId": 9}]	APPROVED	\N	15	15	2026-11-24 09:58:46.748842+00	\N	2026-11-24 09:58:46.748842+00
4	STQ-20261124-3C942A	2045	2046	[{"quantity": 20, "unitName": "Box", "variantId": 822, "medicineId": 1797}]	APPROVED	\N	39	15	2026-11-24 10:14:05.691221+00	\N	2026-11-24 10:13:34.810981+00
5	STQ-20261124-CADF45	2046	1	[{"quantity": 20, "unitName": "Blister Pack", "variantId": 11, "medicineId": 9}, {"quantity": 20, "unitName": "Box", "variantId": 822, "medicineId": 1797}]	APPROVED	\N	12	39	2026-11-24 10:15:46.718018+00	\N	2026-11-24 10:15:39.77105+00
6	STQ-20261124-285973	2045	2046	[{"quantity": 5, "unitName": "Blister Pack", "variantId": 11, "medicineId": 9}]	APPROVED	\N	39	15	2026-11-24 13:21:51.404092+00	\N	2026-11-24 13:21:43.075505+00
\.

COPY public.supplier_payments (id, ap_id, amount, payment_method, reference, cashbook_id, paid_by, paid_at) FROM stdin;
1	2	50000.00	BANK_TRANSFER	BK-20261124-001	4	22	2026-11-24 13:48:10.248425+00
\.

COPY public.transfer_custody (transfer_id, variant_id, quantity, outstanding, box_uids, handed_over_at, received_at) FROM stdin;
1	11	20	0	{00d3d676-808d-4e7d-90be-24fcaf4914aa,0adb66a2-5500-4e8e-a69c-6595eea5205b,1c7e907f-16dc-4cc8-9862-325bb89bd162,2d2a2155-01f0-43da-a6dd-7532ba5d5fd2,39284525-d974-4a81-84fd-ae50b67ccfd6,4d695c75-a991-4531-957f-d865d45db4ec,4f4c10a8-086e-4f5b-9df8-256246394032,5a97163a-bd83-4a97-9507-7435eb944856,61b7ff66-02c9-42a8-a641-4078f546678b,7a118430-dae6-448b-be5b-03a1e9aa9a9b,9d1e777e-3c7e-4cee-b4eb-6f38464bdcba,9d77c5d2-ebad-4213-9ff8-7322dcb7e825,a1b5ab1f-7354-436e-a0f2-e78018443721,af8e42fd-ef43-4104-81e2-d0939fa640e0,beaa161d-e788-4801-82d3-c8992785d857,c6ffdf87-aa58-48c4-8109-4bbc192f85ec,cd3d00ac-3407-4542-8781-e3f3cf457d35,e514ffd4-e438-485b-8009-8298afdce6e5,f25b57c6-4a84-48e6-ae2a-fb5c91679f25,f32a0c25-e74d-484c-8426-d6a925d00fe6}	2026-11-24 09:46:00.617388+00	2026-11-24 09:46:38.433327+00
2	11	20	0	{1106d01f-ae15-427d-a36a-8299b321754a,1377a656-a997-46c7-8349-12cdc2557c31,2abdacb4-d713-4555-a823-d884612ba85e,359ccd95-4e9b-46fa-8410-cae4b90ee0d9,3803b476-baf5-45c1-a045-1800af7cff5a,398b5aa0-12ae-450e-81d2-94f5a01949a0,527f5ea9-a0c9-4da4-b0d8-26c4291a9754,5ca13667-9fed-404d-b57a-75150b080ed4,622a4974-2b81-4d29-8ee2-bbd07b91651a,630d2bb4-5cee-439c-a846-bd0726aaa890,8bcdfdd0-f111-4efc-9464-5deac52dd0f8,986e40a9-ad42-4e13-b702-39c523ab04ee,a350414f-3c2c-4323-bb4c-f44eae071d82,a4253d92-fd3b-40cd-95ef-5da805d736ee,b4e4cf49-972b-49e6-9d4b-abbd0e0bf5dc,c3f42115-9454-4ecc-8a83-662a40769ef5,c8f579d0-dba8-4ae4-8650-8ee87a1e9a9d,d18fc531-95ef-4f1c-bf21-21281bf7b343,db50d3c4-e2dc-4ea2-989c-47c4796490d2,e78c1e5b-4aaf-47c7-82c3-9f5b44ed2bda}	2026-11-24 09:59:18.924429+00	2026-11-24 10:02:19.214048+00
3	822	20	0	{03a7cbe3-ba6e-482a-ba8a-27b7f82f5b46,0d209da7-25a0-4273-b992-12e1792227a6,0eee645d-7348-4302-b3c1-769d30bce2f5,117e95b5-10e3-4892-98bd-a6be938aa9ac,16e4697d-7c90-4831-a9f8-5e877c90955a,2499d91e-b3be-47f5-ae57-c2b206281fce,252c344b-0fe0-48cc-b638-43a784a31b61,28dd3368-4740-4694-83a9-995532a470ac,32a6ed8e-044e-4379-8583-380e9c477a85,3fb196f7-a8d2-43e3-b36a-1beb905849d7,52693654-48c5-40e1-87e7-97423110acf0,602efeac-0ae7-47df-90eb-d6f55e62778c,61a621f9-2da6-4bcf-9555-9ddb0af2cdf4,61d99a2c-4851-4f02-8045-4ff7f00c2f51,74b7af20-05d0-4e21-8a06-d8f2f42797e8,7adbbca7-4db6-48ca-be87-8fc036b608cc,be20cd02-2cc8-466f-afcd-17626269266e,c38adc3f-4bb1-4b82-abf8-dc877e232d21,d714574d-22df-4d2c-b9c9-9a6c02f5f4b2,df32f9a6-bad1-43d2-874a-997facfe5568}	2026-11-24 10:14:51.088664+00	2026-11-24 10:15:03.313546+00
4	11	20	0	{00d3d676-808d-4e7d-90be-24fcaf4914aa,0adb66a2-5500-4e8e-a69c-6595eea5205b,1c7e907f-16dc-4cc8-9862-325bb89bd162,2d2a2155-01f0-43da-a6dd-7532ba5d5fd2,39284525-d974-4a81-84fd-ae50b67ccfd6,4d695c75-a991-4531-957f-d865d45db4ec,4f4c10a8-086e-4f5b-9df8-256246394032,5a97163a-bd83-4a97-9507-7435eb944856,61b7ff66-02c9-42a8-a641-4078f546678b,7a118430-dae6-448b-be5b-03a1e9aa9a9b,9d1e777e-3c7e-4cee-b4eb-6f38464bdcba,9d77c5d2-ebad-4213-9ff8-7322dcb7e825,a1b5ab1f-7354-436e-a0f2-e78018443721,af8e42fd-ef43-4104-81e2-d0939fa640e0,beaa161d-e788-4801-82d3-c8992785d857,c6ffdf87-aa58-48c4-8109-4bbc192f85ec,cd3d00ac-3407-4542-8781-e3f3cf457d35,e514ffd4-e438-485b-8009-8298afdce6e5,f25b57c6-4a84-48e6-ae2a-fb5c91679f25,f32a0c25-e74d-484c-8426-d6a925d00fe6}	2026-11-24 10:18:51.399301+00	2026-11-24 10:19:14.931799+00
4	822	20	0	{03a7cbe3-ba6e-482a-ba8a-27b7f82f5b46,0d209da7-25a0-4273-b992-12e1792227a6,0eee645d-7348-4302-b3c1-769d30bce2f5,117e95b5-10e3-4892-98bd-a6be938aa9ac,16e4697d-7c90-4831-a9f8-5e877c90955a,2499d91e-b3be-47f5-ae57-c2b206281fce,252c344b-0fe0-48cc-b638-43a784a31b61,28dd3368-4740-4694-83a9-995532a470ac,32a6ed8e-044e-4379-8583-380e9c477a85,3fb196f7-a8d2-43e3-b36a-1beb905849d7,52693654-48c5-40e1-87e7-97423110acf0,602efeac-0ae7-47df-90eb-d6f55e62778c,61a621f9-2da6-4bcf-9555-9ddb0af2cdf4,61d99a2c-4851-4f02-8045-4ff7f00c2f51,74b7af20-05d0-4e21-8a06-d8f2f42797e8,7adbbca7-4db6-48ca-be87-8fc036b608cc,be20cd02-2cc8-466f-afcd-17626269266e,c38adc3f-4bb1-4b82-abf8-dc877e232d21,d714574d-22df-4d2c-b9c9-9a6c02f5f4b2,df32f9a6-bad1-43d2-874a-997facfe5568}	2026-11-24 10:18:51.399301+00	2026-11-24 10:19:14.931799+00
5	11	5	0	{05b07c94-6d47-4ff8-9a88-70ea9c1e6f30,475f6836-d23a-4fdd-8013-fb4b1573974d,bc90a554-ceb8-43cb-81cd-dd6329fe15fc,d19dd4b7-61d9-42e7-aa21-9b539f390d82,dd6366cf-0367-4a82-b99c-79b657efd92d}	2026-11-24 13:22:05.043968+00	2026-11-24 13:22:15.583202+00
6	11	5	0	{05b07c94-6d47-4ff8-9a88-70ea9c1e6f30,475f6836-d23a-4fdd-8013-fb4b1573974d,bc90a554-ceb8-43cb-81cd-dd6329fe15fc,d19dd4b7-61d9-42e7-aa21-9b539f390d82,dd6366cf-0367-4a82-b99c-79b657efd92d}	2026-11-24 14:37:13.337929+00	2026-11-24 14:37:30.427114+00
\.

COPY public.transfer_manifests (transfer_id, lines, prepared_by, prepared_at, transaction_id) FROM stdin;
1	[{"boxUids": ["00d3d676-808d-4e7d-90be-24fcaf4914aa", "0adb66a2-5500-4e8e-a69c-6595eea5205b", "1c7e907f-16dc-4cc8-9862-325bb89bd162", "2d2a2155-01f0-43da-a6dd-7532ba5d5fd2", "39284525-d974-4a81-84fd-ae50b67ccfd6", "4d695c75-a991-4531-957f-d865d45db4ec", "4f4c10a8-086e-4f5b-9df8-256246394032", "5a97163a-bd83-4a97-9507-7435eb944856", "61b7ff66-02c9-42a8-a641-4078f546678b", "7a118430-dae6-448b-be5b-03a1e9aa9a9b", "9d1e777e-3c7e-4cee-b4eb-6f38464bdcba", "9d77c5d2-ebad-4213-9ff8-7322dcb7e825", "a1b5ab1f-7354-436e-a0f2-e78018443721", "af8e42fd-ef43-4104-81e2-d0939fa640e0", "beaa161d-e788-4801-82d3-c8992785d857", "c6ffdf87-aa58-48c4-8109-4bbc192f85ec", "cd3d00ac-3407-4542-8781-e3f3cf457d35", "e514ffd4-e438-485b-8009-8298afdce6e5", "f25b57c6-4a84-48e6-ae2a-fb5c91679f25", "f32a0c25-e74d-484c-8426-d6a925d00fe6"], "quantity": 20, "variantId": 11}]	15	2026-11-24 09:46:00.617388+00	130198
2	[{"boxUids": ["1106d01f-ae15-427d-a36a-8299b321754a", "1377a656-a997-46c7-8349-12cdc2557c31", "2abdacb4-d713-4555-a823-d884612ba85e", "359ccd95-4e9b-46fa-8410-cae4b90ee0d9", "3803b476-baf5-45c1-a045-1800af7cff5a", "398b5aa0-12ae-450e-81d2-94f5a01949a0", "527f5ea9-a0c9-4da4-b0d8-26c4291a9754", "5ca13667-9fed-404d-b57a-75150b080ed4", "622a4974-2b81-4d29-8ee2-bbd07b91651a", "630d2bb4-5cee-439c-a846-bd0726aaa890", "8bcdfdd0-f111-4efc-9464-5deac52dd0f8", "986e40a9-ad42-4e13-b702-39c523ab04ee", "a350414f-3c2c-4323-bb4c-f44eae071d82", "a4253d92-fd3b-40cd-95ef-5da805d736ee", "b4e4cf49-972b-49e6-9d4b-abbd0e0bf5dc", "c3f42115-9454-4ecc-8a83-662a40769ef5", "c8f579d0-dba8-4ae4-8650-8ee87a1e9a9d", "d18fc531-95ef-4f1c-bf21-21281bf7b343", "db50d3c4-e2dc-4ea2-989c-47c4796490d2", "e78c1e5b-4aaf-47c7-82c3-9f5b44ed2bda"], "quantity": 20, "variantId": 11}]	15	2026-11-24 09:59:18.924429+00	130204
3	[{"boxUids": ["03a7cbe3-ba6e-482a-ba8a-27b7f82f5b46", "0d209da7-25a0-4273-b992-12e1792227a6", "0eee645d-7348-4302-b3c1-769d30bce2f5", "117e95b5-10e3-4892-98bd-a6be938aa9ac", "16e4697d-7c90-4831-a9f8-5e877c90955a", "2499d91e-b3be-47f5-ae57-c2b206281fce", "252c344b-0fe0-48cc-b638-43a784a31b61", "28dd3368-4740-4694-83a9-995532a470ac", "32a6ed8e-044e-4379-8583-380e9c477a85", "3fb196f7-a8d2-43e3-b36a-1beb905849d7", "52693654-48c5-40e1-87e7-97423110acf0", "602efeac-0ae7-47df-90eb-d6f55e62778c", "61a621f9-2da6-4bcf-9555-9ddb0af2cdf4", "61d99a2c-4851-4f02-8045-4ff7f00c2f51", "74b7af20-05d0-4e21-8a06-d8f2f42797e8", "7adbbca7-4db6-48ca-be87-8fc036b608cc", "be20cd02-2cc8-466f-afcd-17626269266e", "c38adc3f-4bb1-4b82-abf8-dc877e232d21", "d714574d-22df-4d2c-b9c9-9a6c02f5f4b2", "df32f9a6-bad1-43d2-874a-997facfe5568"], "quantity": 20, "variantId": 822}]	15	2026-11-24 10:14:51.088664+00	130216
4	[{"boxUids": ["00d3d676-808d-4e7d-90be-24fcaf4914aa", "0adb66a2-5500-4e8e-a69c-6595eea5205b", "1c7e907f-16dc-4cc8-9862-325bb89bd162", "2d2a2155-01f0-43da-a6dd-7532ba5d5fd2", "39284525-d974-4a81-84fd-ae50b67ccfd6", "4d695c75-a991-4531-957f-d865d45db4ec", "4f4c10a8-086e-4f5b-9df8-256246394032", "5a97163a-bd83-4a97-9507-7435eb944856", "61b7ff66-02c9-42a8-a641-4078f546678b", "7a118430-dae6-448b-be5b-03a1e9aa9a9b", "9d1e777e-3c7e-4cee-b4eb-6f38464bdcba", "9d77c5d2-ebad-4213-9ff8-7322dcb7e825", "a1b5ab1f-7354-436e-a0f2-e78018443721", "af8e42fd-ef43-4104-81e2-d0939fa640e0", "beaa161d-e788-4801-82d3-c8992785d857", "c6ffdf87-aa58-48c4-8109-4bbc192f85ec", "cd3d00ac-3407-4542-8781-e3f3cf457d35", "e514ffd4-e438-485b-8009-8298afdce6e5", "f25b57c6-4a84-48e6-ae2a-fb5c91679f25", "f32a0c25-e74d-484c-8426-d6a925d00fe6"], "quantity": 20, "variantId": 11}, {"boxUids": ["03a7cbe3-ba6e-482a-ba8a-27b7f82f5b46", "0d209da7-25a0-4273-b992-12e1792227a6", "0eee645d-7348-4302-b3c1-769d30bce2f5", "117e95b5-10e3-4892-98bd-a6be938aa9ac", "16e4697d-7c90-4831-a9f8-5e877c90955a", "2499d91e-b3be-47f5-ae57-c2b206281fce", "252c344b-0fe0-48cc-b638-43a784a31b61", "28dd3368-4740-4694-83a9-995532a470ac", "32a6ed8e-044e-4379-8583-380e9c477a85", "3fb196f7-a8d2-43e3-b36a-1beb905849d7", "52693654-48c5-40e1-87e7-97423110acf0", "602efeac-0ae7-47df-90eb-d6f55e62778c", "61a621f9-2da6-4bcf-9555-9ddb0af2cdf4", "61d99a2c-4851-4f02-8045-4ff7f00c2f51", "74b7af20-05d0-4e21-8a06-d8f2f42797e8", "7adbbca7-4db6-48ca-be87-8fc036b608cc", "be20cd02-2cc8-466f-afcd-17626269266e", "c38adc3f-4bb1-4b82-abf8-dc877e232d21", "d714574d-22df-4d2c-b9c9-9a6c02f5f4b2", "df32f9a6-bad1-43d2-874a-997facfe5568"], "quantity": 20, "variantId": 822}]	39	2026-11-24 10:18:51.399301+00	130223
5	[{"boxUids": ["05b07c94-6d47-4ff8-9a88-70ea9c1e6f30", "475f6836-d23a-4fdd-8013-fb4b1573974d", "bc90a554-ceb8-43cb-81cd-dd6329fe15fc", "d19dd4b7-61d9-42e7-aa21-9b539f390d82", "dd6366cf-0367-4a82-b99c-79b657efd92d"], "quantity": 5, "variantId": 11}]	15	2026-11-24 13:22:05.043968+00	130329
6	[{"boxUids": ["05b07c94-6d47-4ff8-9a88-70ea9c1e6f30", "475f6836-d23a-4fdd-8013-fb4b1573974d", "bc90a554-ceb8-43cb-81cd-dd6329fe15fc", "d19dd4b7-61d9-42e7-aa21-9b539f390d82", "dd6366cf-0367-4a82-b99c-79b657efd92d"], "quantity": 5, "variantId": 11}]	39	2026-11-24 14:37:13.337929+00	137499
\.

COPY public.vouchers (id, voucher_code, discount_type, discount_value, min_order_value, max_discount_amount, total_quantity, used_quantity, start_date, end_date, status) FROM stdin;
3	UNAVAILABLE	PERCENT	10.00	100000.00	10000.00	100	0	2028-11-21 17:00:00	2028-11-29 17:00:00	ACTIVE
5	EXPIRED	PERCENT	10.00	100000.00	10000.00	100	0	2026-11-20 17:00:00	2026-11-22 17:00:00	EXPIRED
2	FIX20K	FIXED	20000.00	100000.00	\N	100	0	2026-11-23 17:00:00	2028-11-29 17:00:00	ACTIVE
1	TEST10	PERCENT	10.00	100000.00	50000.00	100	0	2026-11-23 17:00:00	2028-11-29 17:00:00	ACTIVE
4	1VOUCHER	PERCENT	10.00	100000.00	10000.00	1	0	2026-11-23 17:00:00	2028-11-29 17:00:00	ACTIVE
\.

-- Sequence state
SELECT pg_catalog.setval('public.accounts_payable_id_seq', 2, true);
SELECT pg_catalog.setval('public.accounts_receivable_id_seq', 1, false);
SELECT pg_catalog.setval('public.article_categories_id_seq', 1, true);
SELECT pg_catalog.setval('public.article_comments_id_seq', 2, true);
SELECT pg_catalog.setval('public.articles_id_seq', 1, true);
SELECT pg_catalog.setval('public.batch_recall_events_id_seq', 7, true);
SELECT pg_catalog.setval('public.batch_recalls_id_seq', 2, true);
SELECT pg_catalog.setval('public.batch_status_events_id_seq', 4, true);
SELECT pg_catalog.setval('public.batches_id_seq', 6, true);
SELECT pg_catalog.setval('public.box_code_entries_id_seq', 12, true);
SELECT pg_catalog.setval('public.carrier_handovers_id_seq', 1, true);
SELECT pg_catalog.setval('public.cart_items_id_seq', 5, true);
SELECT pg_catalog.setval('public.carton_events_id_seq', 1, false);
SELECT pg_catalog.setval('public.cashbook_logs_id_seq', 4, true);
SELECT pg_catalog.setval('public.categories_id_seq', 1811, true);
SELECT pg_catalog.setval('public.cod_statement_reviews_id_seq', 2, true);
SELECT pg_catalog.setval('public.customers_id_seq', 70, true);
SELECT pg_catalog.setval('public.disposal_attachments_id_seq', 1, true);
SELECT pg_catalog.setval('public.disposal_events_id_seq', 5, true);
SELECT pg_catalog.setval('public.disposal_items_id_seq', 10, true);
SELECT pg_catalog.setval('public.disposals_id_seq', 1, true);
SELECT pg_catalog.setval('public.employees_id_seq', 288, true);
SELECT pg_catalog.setval('public.facilities_id_seq', 2305, true);
SELECT pg_catalog.setval('public.fraud_alerts_id_seq', 1, true);
SELECT pg_catalog.setval('public.goods_receipt_attachments_id_seq', 1, false);
SELECT pg_catalog.setval('public.goods_receipt_lines_id_seq', 2, true);
SELECT pg_catalog.setval('public.goods_receipts_id_seq', 2, true);
SELECT pg_catalog.setval('public.internal_transfers_id_seq', 6, true);
SELECT pg_catalog.setval('public.inventories_id_seq', 12, true);
SELECT pg_catalog.setval('public.inventory_logs_id_seq', 47, true);
SELECT pg_catalog.setval('public.logistics_events_id_seq', 32, true);
SELECT pg_catalog.setval('public.loyalty_point_logs_id_seq', 1, false);
SELECT pg_catalog.setval('public.manufacturers_id_seq', 450, true);
SELECT pg_catalog.setval('public.medicines_id_seq', 1939, true);
SELECT pg_catalog.setval('public.moderation_audit_logs_id_seq', 10, true);
SELECT pg_catalog.setval('public.moderation_reports_id_seq', 1, true);
SELECT pg_catalog.setval('public.online_payment_receipts_id_seq', 1, false);
SELECT pg_catalog.setval('public.order_items_id_seq', 6, true);
SELECT pg_catalog.setval('public.order_package_items_id_seq', 27, true);
SELECT pg_catalog.setval('public.order_packages_id_seq', 3, true);
SELECT pg_catalog.setval('public.order_prescription_reviews_id_seq', 1, true);
SELECT pg_catalog.setval('public.orders_id_seq', 6, true);
SELECT pg_catalog.setval('public.packaging_variants_id_seq', 924, true);
SELECT pg_catalog.setval('public.payment_exception_actions_id_seq', 1, false);
SELECT pg_catalog.setval('public.payment_exceptions_id_seq', 1, false);
SELECT pg_catalog.setval('public.prescriptions_id_seq', 1, true);
SELECT pg_catalog.setval('public.purchase_order_events_id_seq', 7, true);
SELECT pg_catalog.setval('public.purchase_order_items_id_seq', 2, true);
SELECT pg_catalog.setval('public.purchase_orders_id_seq', 2, true);
SELECT pg_catalog.setval('public.qr_scan_logs_id_seq', 14, true);
SELECT pg_catalog.setval('public.return_attachments_id_seq', 1, false);
SELECT pg_catalog.setval('public.return_refund_decisions_id_seq', 1, false);
SELECT pg_catalog.setval('public.return_request_events_id_seq', 6, true);
SELECT pg_catalog.setval('public.return_requests_id_seq', 1, true);
SELECT pg_catalog.setval('public.reviews_id_seq', 2, true);
SELECT pg_catalog.setval('public.shipments_id_seq', 3, true);
SELECT pg_catalog.setval('public.sscc_cartons_id_seq', 12, true);
SELECT pg_catalog.setval('public.stock_count_events_id_seq', 1, false);
SELECT pg_catalog.setval('public.stock_count_lines_id_seq', 1, false);
SELECT pg_catalog.setval('public.stock_counts_id_seq', 1, false);
SELECT pg_catalog.setval('public.stock_transfer_request_events_id_seq', 12, true);
SELECT pg_catalog.setval('public.stock_transfer_requests_id_seq', 6, true);
SELECT pg_catalog.setval('public.supplier_payments_id_seq', 1, true);
SELECT pg_catalog.setval('public.vouchers_id_seq', 5, true);

COMMIT;
