// Render/unit smoke tests for the additive S583a presentation kit.
// Run: npx tsx scripts/test-presentation-kit.tsx
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${name}`);
  }
}

function same(name: string, actual: string, expected: string) {
  ok(name, actual === expected);
  if (actual !== expected) {
    console.error(`    expected: ${expected}`);
    console.error(`    actual:   ${actual}`);
  }
}

function has(name: string, actual: string, expected: string) {
  ok(name, actual.includes(expected));
}

async function main() {
  (globalThis as typeof globalThis & { React?: typeof React }).React = React;

  const ui = await import("../components/ui");
  const render = (node: React.ReactElement) => renderToStaticMarkup(node);

  same(
    "legacy Card render unchanged",
    render(
      React.createElement(
        ui.Card,
        null,
        React.createElement("p", null, "Old card"),
      ),
    ),
    '<div class="rounded-2xl border border-gray-200 bg-white shadow-sm p-5  "><p>Old card</p></div>',
  );
  same(
    "legacy PageHeader render unchanged",
    render(
      React.createElement(ui.PageHeader, {
        title: "Rent",
        subtitle: "Collect",
        eyebrow: "Money",
      }),
    ),
    '<div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div class="flex items-start gap-3.5"><div class="min-w-0"><p class="mb-1 text-xs font-semibold uppercase tracking-wider text-brand">Money</p><h1 class="text-2xl font-bold tracking-tight text-gray-900">Rent</h1><p class="mt-1 max-w-2xl text-sm leading-relaxed text-gray-600">Collect</p></div></div></div>',
  );
  same(
    "legacy StatCard render unchanged",
    render(
      React.createElement(ui.StatCard, {
        label: "Leads",
        value: "12",
        hint: "This week",
      }),
    ),
    '<div class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><div class="flex items-start justify-between gap-2"><p class="text-xs font-semibold uppercase tracking-wider text-gray-500">Leads</p></div><p class="mt-2 text-3xl font-bold tracking-tight text-gray-900">12</p><p class="mt-1 text-xs text-gray-500">This week</p></div>',
  );

  const stageShell = render(
    React.createElement(
      ui.StageShell,
      { title: "Link your portals", subtitle: "One step at a time" },
      React.createElement("p", null, "Guided body"),
    ),
  );
  has("StageShell is guided-width", stageShell, "max-w-[40rem]");
  has("StageShell uses guided body token", stageShell, "var(--vl-type-guided-body)");
  has("StageShell renders title", stageShell, "Link your portals");

  const pageShell = render(
    React.createElement(
      ui.PageShell,
      { title: "Workbench", subtitle: "Operator scan surface" },
      React.createElement("p", null, "Dense body"),
    ),
  );
  has("PageShell uses workbench body token", pageShell, "var(--vl-type-workbench-body)");
  has("PageShell reuses PageHeader content", pageShell, "Operator scan surface");

  const statusBanner = render(
    React.createElement(
      ui.StatusBanner,
      { tone: "success", title: "Already linked" },
      "Ready to send listings automatically.",
    ),
  );
  has("StatusBanner uses role=status", statusBanner, 'role="status"');
  has("StatusBanner renders status in words", statusBanner, "Already linked");
  has(
    "StatusBanner uses macro success token",
    statusBanner,
    "var(--vl-status-success-bg)",
  );
  ok(
    "StatusBanner tone aligns to StatusChip tone",
    ui.STATUS_BANNER_TONE_TO_CHIP_TONE.attention === "warn",
  );

  const button = render(
    React.createElement(
      ui.Button,
      { variant: "primary", size: "lg", disabled: true },
      "Next",
    ),
  );
  has("Button wraps primary class", button, ui.PRIMARY_ACTION_CLASS);
  has("Button large target is at least 48px", button, "min-h-12");
  has("Button has disabled state", button, "disabled");
  has("Button has focus-visible ring", button, "focus-visible:ring-[var(--vl-focus-ring)]");

  const field = render(
    React.createElement(
      ui.Field,
      {
        label: "Email",
        htmlFor: "email",
        error: "Use a valid email.",
      },
      React.createElement(ui.Input, {
        id: "email",
        name: "email",
        invalid: true,
      }),
    ),
  );
  has("Field labels inputs", field, 'for="email"');
  has("Input marks invalid", field, 'aria-invalid="true"');
  has("Field renders error alert", field, 'role="alert"');

  const select = render(
    React.createElement(
      ui.Select,
      { name: "channel", defaultValue: "instagram" },
      React.createElement("option", { value: "instagram" }, "Instagram"),
    ),
  );
  has("Select renders options", select, "Instagram");
  has("Select has focus ring", select, "focus:ring-[var(--vl-focus-ring)]");

  const languageDropdown = render(
    React.createElement(ui.LanguageDropdown, {
      locale: "fr",
      action: "/i18n",
      label: "Language",
      submitLabel: "Apply",
    }),
  );
  has("LanguageDropdown renders EN option", languageDropdown, ">EN<");
  has("LanguageDropdown renders FR option", languageDropdown, ">FR<");
  has("LanguageDropdown posts locale field", languageDropdown, 'name="locale"');

  let calledLocale = "";
  const localeAction = ui.languageDropdownFormAction((locale) => {
    calledLocale = locale;
  });
  const localeForm = new FormData();
  localeForm.set("locale", "fr");
  await localeAction(localeForm);
  ok("LanguageDropdown form action calls setLocale-compatible callback", calledLocale === "fr");

  const backNext = render(
    React.createElement(ui.BackNext, {
      backHref: "/back",
      nextHref: "/next",
      backLabel: "Back",
      nextLabel: "Next Step",
    }),
  );
  has("BackNext uses fixed anchors", backNext, "fixed inset-x-0 bottom-0");
  has("BackNext renders back href", backNext, 'href="/back"');
  has("BackNext renders next href", backNext, 'href="/next"');

  const table = render(
    React.createElement(
      ui.DataTable,
      { caption: "Channels" },
      React.createElement(
        "tbody",
        null,
        React.createElement(
          ui.DataTableRow,
          { interactive: true, selected: true },
          React.createElement(ui.DataTableCell, { as: "th", scope: "row" }, "Portal"),
          React.createElement(ui.DataTableCell, { numeric: true }, "3"),
        ),
      ),
    ),
  );
  has("DataTable renders a real table", table, "<table");
  has("DataTable has sr-only caption", table, "Channels");
  has("DataTable row exposes selected state", table, 'data-selected="true"');
  has("DataTable numeric cell is tabular", table, "tabular-nums");

  const globals = readFileSync("app/globals.css", "utf8");
  has("globals define neutral surface token", globals, "--vl-surface: #f9fafb");
  has("globals derive kit accent from brand", globals, "--vl-accent: var(--brand-color)");
  has("globals define focus token", globals, "--vl-focus-ring:");
  has("globals honor reduced motion", globals, "prefers-reduced-motion: reduce");

  const tailwind = readFileSync("tailwind.config.ts", "utf8");
  has("tailwind exposes presentation namespace", tailwind, "presentation:");
  has("tailwind exposes guided body type", tailwind, "vl-guided-body");
  has("tailwind exposes workbench body type", tailwind, "vl-workbench-body");

  const actions = readFileSync("app/i18n/actions.ts", "utf8");
  has("i18n form action wraps S582 setLocale", actions, "setLocaleFromFormData");
  has("i18n form action calls setLocale", actions, "await setLocale");

  const enMessages = JSON.parse(readFileSync("messages/en.json", "utf8")) as Record<
    string,
    unknown
  >;
  const frMessages = JSON.parse(readFileSync("messages/fr.json", "utf8")) as Record<
    string,
    unknown
  >;
  ok(
    "en/fr message catalogs keep top-level parity",
    Object.keys(enMessages).sort().join("|") ===
      Object.keys(frMessages).sort().join("|"),
  );

  console.log(`\npresentation-kit: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
