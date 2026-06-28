-- =====================================================================
-- Vacantless QA — CANONICAL RESET for the Codex review
-- Target org: North Star Rentals QA (b733a191-30fd-47fe-bd21-731404148026)
-- Project ref: nvhvdyxpyogvadpjlvij
-- Updated: 2026-06-28 (v2 — deterministic reset, clause versions)
--
-- WHAT CHANGED FROM v1: this is now a DETERMINISTIC RESET, not an additive
-- insert. v1 used `ON CONFLICT DO NOTHING`, so it could not correct drift (rows
-- edited during testing kept their changed values). v2 first DELETES the org's
-- rows in the leasing tables, then inserts the canonical set with fixed UUIDs —
-- so every run lands on the same known state. It also seeds lease-clause
-- VERSIONS (v1 left clauses with "no current version", so clause flows weren't
-- testable).
--
-- DESTRUCTIVE: this wipes the QA org's properties / leads / showings /
-- tenancies / tenants / lease clauses (+ versions) / photos and rebuilds them.
-- It is hard-scoped to the QA org id and must NEVER be pointed at a real org.
-- availability_rules are left untouched (the org's two viewing windows already
-- power the public booking flow).
-- =====================================================================

BEGIN;

-- --- Org config: representative paid tier + branding + public contact ---
UPDATE organizations SET
  plan = 'growth',
  sms_enabled = true,
  screening_enabled = true,
  brand_color = '#2563eb',
  public_contact_phone = '(519) 915-8865',
  public_contact_email = 'rentals@vacantless-demo.ca'
WHERE id = 'b733a191-30fd-47fe-bd21-731404148026';

-- --- Clear the org's leasing rows so the reset is canonical (FK-safe order) ---
DELETE FROM tenancies            WHERE organization_id = 'b733a191-30fd-47fe-bd21-731404148026'; -- cascades tenants
DELETE FROM showings             WHERE organization_id = 'b733a191-30fd-47fe-bd21-731404148026';
DELETE FROM leads                WHERE organization_id = 'b733a191-30fd-47fe-bd21-731404148026'; -- cascades messages
DELETE FROM lease_clause_versions WHERE organization_id = 'b733a191-30fd-47fe-bd21-731404148026';
DELETE FROM lease_clauses        WHERE organization_id = 'b733a191-30fd-47fe-bd21-731404148026';
DELETE FROM property_photos
  WHERE property_id IN (SELECT id FROM properties WHERE organization_id = 'b733a191-30fd-47fe-bd21-731404148026');
DELETE FROM properties           WHERE organization_id = 'b733a191-30fd-47fe-bd21-731404148026'; -- cascades listing_posts

-- --- Properties (status 'available' = Live). building_key is GENERATED. ---
INSERT INTO properties (id, organization_id, address, rent_cents, beds, baths, parking,
  status, laundry, air_conditioning, ac_type, heat_included, hydro_included, water_included,
  furnished, smoking, lease_term, pets_cats, pets_dogs, sqft, available_date, description)
VALUES
  ('11111111-1111-4111-8111-111111111101','b733a191-30fd-47fe-bd21-731404148026','833 Pillette Road, Windsor, ON',129500,1,1,'1 spot included','available','in_building',true,'window',true,false,true,false,'non_smoking','1_year',true,false,600,CURRENT_DATE+14,'Bright one-bedroom in a well-kept Windsor building. Laundry in building, one parking spot included. Heat and water included; hydro paid by tenant. Unfurnished. Available next month.'),
  ('11111111-1111-4111-8111-111111111102','b733a191-30fd-47fe-bd21-731404148026','18 Shorncliffe Avenue, Toronto, ON',220000,2,1,'1 spot included','available','in_suite',true,'central',true,false,true,false,'non_smoking','1_year',true,false,850,CURRENT_DATE+21,'Two-bedroom unit in a multi-unit Toronto property. In-suite laundry, central air, one parking spot. Heat and water included; hydro paid by tenant. Building-specific lease clauses apply.'),
  ('11111111-1111-4111-8111-111111111103','b733a191-30fd-47fe-bd21-731404148026','506 Manning Avenue, Toronto, ON',195000,2,1,'Street parking','available','in_building',false,'window',false,false,true,false,'non_smoking','1_year',true,false,800,CURRENT_DATE+30,'Two-bedroom unit in a Manning Avenue triplex. Flat monthly gas charge billed to tenant; hydro paid by tenant; water included. Ontario standard lease.');

-- --- Renter inquiries (leads): 8 spanning the pipeline ---
INSERT INTO leads (id, organization_id, property_id, name, email, phone, source, status,
  move_in, notes, screen_income_cents, screen_occupants, screen_has_pets, screen_pets_detail,
  qualified_out, qualify_out_reasons, leased_date, next_action_at, next_action_note, created_at)
VALUES
  ('22222222-2222-4222-8222-222222222201','b733a191-30fd-47fe-bd21-731404148026','11111111-1111-4111-8111-111111111101','Maria Santos','maria.santos@example.com','519-555-0101','Kijiji','new',CURRENT_DATE+5,'Wants to move in this month.',420000,1,false,NULL,false,'{}',NULL,CURRENT_DATE,'Reply with viewing times',now()-interval '1 day'),
  ('22222222-2222-4222-8222-222222222202','b733a191-30fd-47fe-bd21-731404148026','11111111-1111-4111-8111-111111111102','David Chen','david.chen@example.com','416-555-0102','Rentals.ca','replied',CURRENT_DATE+90,'Relocating in ~3 months; flexible on date.',780000,2,false,NULL,false,'{}',NULL,CURRENT_DATE+2,'Follow up on timing',now()-interval '2 days'),
  ('22222222-2222-4222-8222-222222222203','b733a191-30fd-47fe-bd21-731404148026','11111111-1111-4111-8111-111111111103','Priya Patel','priya.patel@example.com','647-555-0103','Facebook Marketplace','contacted',CURRENT_DATE+45,'Asked whether parking is available.',610000,1,false,NULL,false,'{}',NULL,CURRENT_DATE+1,'Answer parking question',now()-interval '3 days'),
  ('22222222-2222-4222-8222-222222222204','b733a191-30fd-47fe-bd21-731404148026','11111111-1111-4111-8111-111111111101','James O''Connor','james.oconnor@example.com','519-555-0104','Kijiji','contacted',CURRENT_DATE+30,'Has one cat; asked about the pet policy.',540000,1,true,'One cat, spayed',true,'{pets}',NULL,CURRENT_DATE+1,'Confirm pet policy',now()-interval '3 days'),
  ('22222222-2222-4222-8222-222222222205','b733a191-30fd-47fe-bd21-731404148026','11111111-1111-4111-8111-111111111102','Aisha Mohamed','aisha.mohamed@example.com','416-555-0105','Vacantless page','booked',CURRENT_DATE+30,'Booked a viewing for later this week.',900000,3,false,NULL,false,'{}',NULL,CURRENT_DATE+3,'Send viewing reminder',now()-interval '2 days'),
  ('22222222-2222-4222-8222-222222222206','b733a191-30fd-47fe-bd21-731404148026','11111111-1111-4111-8111-111111111103','Tomasz Nowak','tomasz.nowak@example.com','647-555-0106','Kijiji','replied',CURRENT_DATE+60,'Inquired but declined to book a viewing time.',700000,2,false,NULL,false,'{}',NULL,NULL,NULL,now()-interval '4 days'),
  ('22222222-2222-4222-8222-222222222207','b733a191-30fd-47fe-bd21-731404148026','11111111-1111-4111-8111-111111111101','Sofia Rossi','sofia.rossi@example.com','519-555-0107','Rentals.ca','applied',CURRENT_DATE+20,'Viewed the unit, then applied.',680000,2,false,NULL,false,'{}',NULL,CURRENT_DATE+1,'Review application',now()-interval '6 days'),
  ('22222222-2222-4222-8222-222222222208','b733a191-30fd-47fe-bd21-731404148026','11111111-1111-4111-8111-111111111102','Liang Wu','liang.wu@example.com','416-555-0108','Vacantless page','leased',CURRENT_DATE+15,'Approved and converted to a tenancy.',1020000,2,false,NULL,false,'{}',CURRENT_DATE,NULL,NULL,now()-interval '7 days');

-- --- Showings ---
INSERT INTO showings (id, organization_id, lead_id, property_id, scheduled_at, outcome)
VALUES
  ('33333333-3333-4333-8333-333333333301','b733a191-30fd-47fe-bd21-731404148026','22222222-2222-4222-8222-222222222205','11111111-1111-4111-8111-111111111102',(CURRENT_DATE+3)::timestamptz + interval '18 hours','scheduled'),
  ('33333333-3333-4333-8333-333333333302','b733a191-30fd-47fe-bd21-731404148026','22222222-2222-4222-8222-222222222207','11111111-1111-4111-8111-111111111101',(CURRENT_DATE-5)::timestamptz + interval '17 hours','attended');

-- --- Tenancy (Liang Wu, lead 8 -> 18 Shorncliffe) with a co-tenant ---
-- Active: this is the row that must make 18 Shorncliffe read "Tenant in place".
INSERT INTO tenancies (id, organization_id, property_id, lead_id, rent_cents, deposit_cents, start_date, end_date, term_months, status, notes)
VALUES
  ('44444444-4444-4444-8444-444444444401','b733a191-30fd-47fe-bd21-731404148026','11111111-1111-4111-8111-111111111102','22222222-2222-4222-8222-222222222208',220000,220000,CURRENT_DATE,CURRENT_DATE+365,12,'active','Converted from Liang Wu''s inquiry. First and last month collected.');

INSERT INTO tenants (id, organization_id, tenancy_id, name, email, phone, is_primary)
VALUES
  ('55555555-5555-4555-8555-555555555501','b733a191-30fd-47fe-bd21-731404148026','44444444-4444-4444-8444-444444444401','Liang Wu','liang.wu@example.com','416-555-0108',true),
  ('55555555-5555-4555-8555-555555555502','b733a191-30fd-47fe-bd21-731404148026','44444444-4444-4444-8444-444444444401','Mei Wu','mei.wu@example.com','416-555-0109',false);

-- --- Lease-clause library + a CURRENT version each (so clause flows work) ---
INSERT INTO lease_clauses (id, organization_id, key, title, category, applicable_to, risk_level, jurisdiction, notes_for_landlord)
VALUES
  ('66666666-6666-4666-8666-666666666601','b733a191-30fd-47fe-bd21-731404148026','no_smoking','No Smoking','rules','residential','standard','ontario','Standard Ontario non-smoking clause.'),
  ('66666666-6666-4666-8666-666666666602','b733a191-30fd-47fe-bd21-731404148026','parking_space','Parking Space Assignment','general','residential','standard','ontario','Assigns the included parking spot; uses a {{parking_spot}} placeholder filled per tenancy.'),
  ('66666666-6666-4666-8666-666666666603','b733a191-30fd-47fe-bd21-731404148026','tenant_insurance','Tenant Insurance Required','insurance','residential','caution','ontario','Ontario allows requiring liability insurance, but you cannot mandate a specific provider.'),
  ('66666666-6666-4666-8666-666666666604','b733a191-30fd-47fe-bd21-731404148026','guest_policy','Overnight Guests','rules','residential','legal_review','ontario','Overly restrictive guest limits risk an RTA challenge — review before use.');

-- One current version per clause. Two carry {{tokens}} so placeholder fill +
-- missing-placeholder warnings are testable.
INSERT INTO lease_clause_versions (id, organization_id, clause_id, version, body, is_current, note)
VALUES
  ('88888888-8888-4888-8888-888888888801','b733a191-30fd-47fe-bd21-731404148026','66666666-6666-4666-8666-666666666601',1,
   'The Tenant and the Tenant''s guests shall not smoke any substance, including tobacco, cannabis, or vaping products, anywhere inside the rental unit or the residential complex.',
   true,'Initial version.'),
  ('88888888-8888-4888-8888-888888888802','b733a191-30fd-47fe-bd21-731404148026','66666666-6666-4666-8666-666666666602',1,
   'The Landlord assigns parking space {{parking_spot}} to the Tenant for the term of the tenancy, for one operable, licensed vehicle.',
   true,'Initial version.'),
  ('88888888-8888-4888-8888-888888888803','b733a191-30fd-47fe-bd21-731404148026','66666666-6666-4666-8666-666666666603',1,
   'The Tenant shall obtain and maintain tenant liability insurance of at least {{insurance_amount}} for the term of the tenancy and provide proof of coverage on the Landlord''s reasonable request.',
   true,'Initial version.'),
  ('88888888-8888-4888-8888-888888888804','b733a191-30fd-47fe-bd21-731404148026','66666666-6666-4666-8666-666666666604',1,
   'Overnight guests staying more than {{guest_limit_days}} consecutive days require the Landlord''s prior written consent, not to be unreasonably withheld.',
   true,'Initial version — flagged for legal review.');

-- --- Photos for 833 Pillette (so the public gallery + lightbox are reviewable).
-- url is what the public RPC returns (cover first). The other two units stay
-- photo-free on purpose so the empty-gallery / "No photos" label is also testable.
INSERT INTO property_photos (id, organization_id, property_id, storage_path, url, sort_order, is_cover)
VALUES
 ('77777777-7777-4777-8777-777777777701','b733a191-30fd-47fe-bd21-731404148026','11111111-1111-4111-8111-111111111101','seed/833-pillette/living.jpg','https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1200&q=80',0,true),
 ('77777777-7777-4777-8777-777777777702','b733a191-30fd-47fe-bd21-731404148026','11111111-1111-4111-8111-111111111101','seed/833-pillette/bedroom.jpg','https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=1200&q=80',1,false),
 ('77777777-7777-4777-8777-777777777703','b733a191-30fd-47fe-bd21-731404148026','11111111-1111-4111-8111-111111111101','seed/833-pillette/kitchen.jpg','https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=1200&q=80',2,false);
UPDATE properties SET photos_ready=true WHERE id='11111111-1111-4111-8111-111111111101';

COMMIT;
