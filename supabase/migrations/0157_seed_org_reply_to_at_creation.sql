-- 0157: Seed organizations.reply_to_email at creation (S511 reply-routing guard)
--
-- Why: renter replies to automated mail use the org's reply_to_email as Reply-To,
-- falling back to the shared leads@vacantless.com when the org's field is blank
-- (lib/email.ts replyToOf). A provisioning gap left new orgs with a null
-- reply_to_email, so replies silently landed in the shared inbox instead of the
-- customer's own inbox (observed on Agile: Jul 15 auto-reply + Jul 17 booking
-- confirmation replies both went to leads@vacantless.com). The per-org
-- mechanism is correct; only the initial value was missing.
--
-- Fix: seed reply_to_email from the owner's login email at org creation in both
-- creation RPCs (self-serve create_organization + admin
-- provision_organization_for_user). Best-effort: the auth.users read is wrapped
-- so any failure leaves reply_to_email null (today's behaviour) and never blocks
-- signup/provisioning. Operators can still override in Settings. Concierge
-- provisioning continues to overwrite this with the proxy email post-create.

CREATE OR REPLACE FUNCTION public.create_organization(p_name text, p_slug text)
 RETURNS organizations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org public.organizations;
  v_reply_to text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  begin
    select nullif(btrim(u.email), '')
      into v_reply_to
    from auth.users u
    where u.id = auth.uid();
  exception when others then
    v_reply_to := null;
  end;

  insert into public.organizations (name, slug, reply_to_email)
  values (p_name, p_slug, v_reply_to)
  returning * into v_org;

  insert into public.memberships (organization_id, user_id, role)
  values (v_org.id, auth.uid(), 'owner_admin');

  return v_org;
end;
$function$;

CREATE OR REPLACE FUNCTION public.provision_organization_for_user(p_user_id uuid, p_name text, p_slug text)
 RETURNS organizations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org public.organizations;
  v_reply_to text;
begin
  if p_user_id is null then
    raise exception 'user id required';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'org name required';
  end if;

  begin
    select nullif(btrim(u.email), '')
      into v_reply_to
    from auth.users u
    where u.id = p_user_id;
  exception when others then
    v_reply_to := null;
  end;

  insert into public.organizations (name, slug, reply_to_email)
  values (p_name, p_slug, v_reply_to)
  returning * into v_org;

  insert into public.memberships (organization_id, user_id, role)
  values (v_org.id, p_user_id, 'owner_admin');

  return v_org;
end;
$function$;
