---
version: alpha
name: Swing Syndicate at Cornell
description: The club's public site, event manager and door check-in. White background, warm ink, one berry accent.
colors:
  primary: "#a13a5e"
  primary-hover: "#aa4e6e"
  on-primary: "#ffffff"
  surface: "#ffffff"
  on-surface: "#232019"
  muted: "#f4f3f1"
  on-muted: "#5f5c55"
  border: "#e6e4e0"
  input-border: "#cfcdc7"
  placeholder: "#a8a49c"
  error: "#a22031"
typography:
  home-h1:
    fontFamily: Fraunces
    fontSize: 60px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.01em
  home-h2:
    fontFamily: Fraunces
    fontSize: 36px
    fontWeight: 600
    lineHeight: 1.1
  site-name:
    fontFamily: Fraunces
    fontSize: 18px
    fontWeight: 600
    lineHeight: 24px
  page-title:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.1
  title:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.25
  manager-title:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.25
  list-title:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.3
  section-title:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.4
  list-title-dense:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 450
    lineHeight: 1.5
  secondary:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 450
    lineHeight: 1.5
  button-label:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 500
  button-label-large:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 500
  caption:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 500
  date-tile-month:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0.04em
rounded:
  checkbox: 4px
  control: 8px
  inner: 6px
  card: 12px
  full: 999px
spacing:
  base: 4px
  page-width: 920px
  manager-width: 866px
  check-in-width: 620px
  gutter-desktop: 20px
  gutter-phone: 16px
components:
  button-public:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-label}"
    rounded: "{rounded.control}"
    height: 40px
    padding: 16px
  button-public-hover:
    backgroundColor: "{colors.primary-hover}"
  button-public-touch:
    height: 44px
  button-large:
    typography: "{typography.button-label-large}"
    rounded: "{rounded.control}"
    height: 44px
    padding: 20px
  button-manager:
    typography: "{typography.button-label}"
    rounded: "{rounded.control}"
    height: 32px
    padding: 10px
  button-manager-touch:
    height: 40px
    padding: 16px
  button-small:
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    height: 28px
    padding: 10px
  button-small-touch:
    height: 40px
  icon-button:
    rounded: "{rounded.control}"
    size: 32px
  icon-button-public-touch:
    size: 44px
  icon-button-manager-touch:
    size: 40px
  clear-button:
    rounded: "{rounded.control}"
    size: 24px
  field-public:
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: 40px
  field-floating-label:
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: 56px
  field-manager:
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: 32px
  field-manager-touch:
    height: 40px
  chip:
    typography: "{typography.secondary}"
    rounded: "{rounded.full}"
    height: 32px
    padding: 12px
  chip-touch:
    height: 40px
    padding: 16px
  segmented-switch:
    backgroundColor: "{colors.muted}"
    rounded: "{rounded.control}"
    height: 32px
    padding: 2px
  segmented-switch-touch:
    height: 44px
  segment:
    typography: "{typography.secondary}"
    rounded: "{rounded.inner}"
    height: 28px
  segment-touch:
    height: 40px
  tab:
    typography: "{typography.button-label}"
    height: 40px
  back-button:
    typography: "{typography.button-label}"
    height: 40px
  menu-row:
    typography: "{typography.body}"
    rounded: "{rounded.inner}"
    height: 32px
  menu-row-touch:
    height: 40px
  calendar-day:
    rounded: "{rounded.inner}"
    size: 28px
  calendar-day-touch:
    size: 36px
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
---

Sizing was informed by the unofficial Cal.com DESIGN.md and behavior rules by Vercel's Web Interface Guidelines. Their colors, fonts and pill buttons were not adopted.

## Overview

A student dance club's website: plain, warm and easy to use on a phone at the door. The owner rejected an earlier, more decorated design as gaudy, so nothing here is decorative.

Sizes are set per page area in `src/theme.css`. Public pages are roomy, the manager is dense with a mouse and finger-sized on touch, and check-in uses large controls for standing at a kiosk.

## Colors

- **Primary (#a13a5e):** berry, the only accent. Main buttons, focus rings, the next event's date tile, text link buttons.
- **Surface (#ffffff) and on-surface (#232019):** white pages and warm ink. All text and form text uses the ink, never pure black.
- **Muted (#f4f3f1) and on-muted (#5f5c55):** grouped panels, hover backgrounds, secondary text.
- **Border (#e6e4e0) and input-border (#cfcdc7):** dividers and field outlines.
- **Error (#a22031):** error text, destructive buttons, and figures that need a second look.

## Typography

Inter is the font for everything, with two exceptions on the main public site:

- **Fraunces** for homepage headings, and for dialog titles opened from the homepage.
- **Fraunces** for the site name on the homepage, /events, event pages and check-in.

The manager uses Inter for all text including its site name. /events and event pages use Inter for their headings and dialog titles.

Responsive sizes: homepage h1 60 to 40, homepage h2 36 to 28, page title 32 to 28, site name 16 at 380px and narrower. Numbers that line up in a column or change in place use tabular figures.

## Layout

Spacing moves in 4px steps. Public pages are 920px wide, the manager 866px, check-in 620px. Label-above fields are for long forms and floating-label fields for short ones.

## Elevation & Depth

The design is flat. Cards are outlined, popups and dialogs have a 1px ring or border, and dialogs dim the page behind them. The one shadow left is on the homepage carousel's dots, so they read over photos.

## Shapes

Controls have 8px corners, parts inside a control (segments, menu rows, calendar days) 6px, cards, dialogs and panels 12px. Chips and badges are pills.

## Components

- **Buttons:** public 40, or 44 on touch. Main actions 44 at 16px. Manager 32, or 40 on touch. Small buttons (28 at 13px) only in manager table and heading rows, the newsletter link bar and the newsletter's hover Add announcement.
- **Fields:** public label-above 40 at 16px. Floating-label 56. Manager 32, or 40 on touch. Text is 16px in every field, including selects.
- **Icons:** 14 in small buttons and table status, 16 by default, 20 only for the next event's pin.
- **Menus:** rows 32, or 40 on touch, at 16px so an option matches its field once chosen.
- **Tabs:** underlined line style, on Base UI.
- **Switches and chips:** Toggle Group on Base UI. Segmented switch for one choice, chips for filters and multiple choices.
- **Checkboxes:** 16px with 4px corners, inside a label that takes the click. On Base UI.
- **Check-in:** 44 buttons, 56 fields and 64 rows. Payment screens leave out the site header so each shows a single question.

## Do's and Don'ts

- Do keep one berry accent on white with warm ink.
- Do use tokens from `src/theme.css` and the shared components, and change a size at the source.
- Do give every control a visible focus state and a hover state.
- Do let long words wrap in headings instead of widening the page.
- Don't use Fraunces outside homepage headings and the public site name. Don't use it in the manager.
- Don't add shadows, gradients, decorative text or extra accent colors.
- Don't add new sizes between the ones listed here.
- Don't use small buttons on public pages.
- Don't use `transition: all`.
