# @designless/react-native

Your brand in a React Native app. Colours, type, spacing and marks come
from the brand you published, and change when you publish again.

This package carries no brand values of its own. It fetches what you
published, keeps a copy, and maps it to the types React Native draws with.
A brand change reaches your app without a release of this package.

## Install

```sh
npm install @designless/react-native
```

## Use

```tsx
import { DesignlessProvider, useBrandTheme } from "@designless/react-native";

<DesignlessProvider publicId="r_XXXX">
  <App />
</DesignlessProvider>;

function Title() {
  const theme = useBrandTheme();
  if (!theme) return null;
  return (
    <Text style={[theme.text({ family: "display", weight: "heading" }), {
      color: theme.color["text.primary"],
    }]}>
      Hello
    </Text>
  );
}
```

## The API: five verbs

These five are the whole surface of this package. Other Designless
packages answer to the same names where they can, and each one is shaped
by what its platform can do, so check the readme of the one you are
using rather than assuming this page describes it.

```ts
import { createBrand } from "@designless/react-native";

const brand = createBrand({ publicId: "r_XXXX" });

await brand.init();          // settle the first copy
brand.tokens();              // the theme, or null before there is one
brand.asset("logo-symbol");  // where a brand mark lives
brand.fonts();               // the published faces, with this build folded in
brand.subscribe(listener);   // changes. Returns the function that stops them
```

`createBrand` calls `init()` for you. Call it yourself only if you passed
`autoInit: false`.

## Three things worth reading before you ship

### 1. Fonts are settled when the app is built, not while it runs

React Native core has no way to add a font at runtime. There is no
registration call, no path to the platform font managers, and nowhere to
stage a download. Some libraries reach past that, `expo-font` among them,
and this package deliberately does not: it downloads nothing at runtime
and registers nothing. The set of usable faces is fixed by your build.

Two things therefore have to be true, and if either is missing your text
renders in the platform font for the life of the app. It does not throw
and it does not log.

1. The font files are in the build.
2. This package has been told which ones, by PostScript name.

Two commands do both:

```sh
npx designless-snapshot --brand=r_XXXX   # take a copy of the brand
npx designless-fonts --brand=r_XXXX      # download the faces, record the names
```

`designless-fonts` writes the files into `assets/fonts` and records their
names in the snapshot, so nothing has to be kept in step by hand. It reads
the name out of each downloaded file rather than trusting the list, and
skips any file that does not call itself what it was published as.

Then include the folder in your build and rebuild the app. The command
prints both steps for your setup, Expo or bare. A font added to a build is
only in that build, so reloading over an older one will not pick it up.

Include it through the build, with the `expo-font` config plugin or
`react-native.config.js`, so the faces are compiled into the binary and
are there before the first frame. Loading them while the app runs instead,
with `useFonts` or `loadAsync`, leaves every frame until that resolves in
the platform font. If you do that, hold the first screen back until it has.

Downloading the files is not the same as shipping them, so there is a
check for the difference:

```sh
npx designless-fonts --check
```

It reads what is already there, needs no network, and exits non-zero when
a recorded face is no longer on disk under the name the app looks it up
by, or when your build config does not carry it into the binary. Both of
those end in the platform font with nothing thrown and nothing logged,
which is why this belongs in continuous integration next to the snapshot
check.

`app.json` and `app.config.json` are parsed, and every recorded face has
to be named by the `expo-font` plugin or by `assetBundlePatterns`, either
as a file or as the folder that holds it. Listing some of them fails, and
the ones that were left out are printed. `app.config.js`,
`app.config.ts` and `react-native.config.js` are code, so they are only
searched for the folder name and the check says so rather than reporting
it as the same answer.

Without a snapshot, pass the list directly:

```ts
createBrand({ publicId: "r_XXXX", fonts: { present: ["Inter-Regular"] } });
```

Setting `present` takes over from the snapshot completely, including when
you set it to an empty list, which says this build has no brand faces in
it. A development build says so when that contradicts the snapshot.

`--roles` says which text roles to include. `body` is the default and is
usually the right answer: it is the face most of your screen is made of.
`all` takes everything the brand publishes, and costs more app size.
`none` takes nothing, and passing `fonts: { roles: "none" }` to
`createBrand` as well changes the development warning from something to
fix into a note that this is how the build was set up.

In a development build, any role that wanted a face this build does not
contain says so once, naming the family and the command that adds it. The
command names the flag that would actually add that role, which is not
always the one the build already ran: a build set up with `--roles=body`
and missing its display face is told `--roles=all`.

A role the brand publishes no face for also says so once, and names the
roles it does publish. That is not an accusation. A brand need not
publish a mono face. But a role that does not exist and a role that was
misspelled reach the same place, and `theme.text({ family: "captoin" })`
gave text in the platform font with nothing said about it at all.

### A face can answer a request it does not exactly match

Two substitutions happen, and both are reported in a development build
for the same reason the missing-face warning exists: the result looks
applied.

A weight is answered from the nearest face within two steps. A family
publishing 400 and 600 answers a request for 500 with 600, and a family
publishing only 300 answers 400 and 500 with 300. Further than two steps
is refused and the platform font is used instead. Nothing is set beside a
resolved face to say which weight it really is, so the warning is the
only signal.

A style is answered from the other one when the family publishes only
that one. A family with italics and no upright face renders every string
in the role in italic.

Both are what the brand published, so neither is an error. If they are
not what you meant, publish the face, or ask for a weight the family has.

### 2. A face is named by its PostScript name, never by its family

`Inter-SemiBold`, not `Inter`. The platforms resolve on the PostScript
name, and a family name only ever finds the regular weight in it: the
semibold file registers under its own name, and the record that would
group the two together is not one the platforms read. Asking for the
family and setting a weight beside it renders regular and warns about
nothing.

This package never hands React Native a family name, which is why
`theme.text()` is the only supported way to build a text style. It also
does not set a weight beside a face it resolved, because the face already
carries its weight and asking for one on top invites the platform to
thicken an already bold face.

```ts
theme.text({ family: "body", size: "lg", weight: "heading", line: "normal" });
```

### 3. Live re-theme is not universal

A published change reaches a running app, but only values that are read
during a render can change what is on screen.

```ts
// Reads once, when the file is first imported. Never looks again.
const styles = StyleSheet.create({ card: { padding: theme.space.md } });

// Reads on every render a change invalidates. Null until there is a theme.
const styles = useThemedStyles((t) => StyleSheet.create({
  card: { padding: t.space.md },
}));
```

Anything built from brand values at module scope is a photograph. Use
`useThemedStyles` for styles, and the hooks for everything else. Native
code outside React, and any view already handed to the platform, keeps
what it was given until it is built again.

By default a change that arrives on its own is fetched straight away and
applied when the app next comes to the front, because a screen that
restyles under someone mid-tap is worse than one that restyles between two
things they were doing. `live: { activate: "immediate" }` changes that.

## The first frame

| What the build has | What opens on a cold install with no network |
|---|---|
| A snapshot | Your brand, from the snapshot |
| Storage only | Unbranded, then your brand once storage is read |
| Neither | Unbranded, then your brand once the network answers |

A snapshot holds one appearance, whichever one it was taken in, and
`designless-snapshot` takes light unless you ask for dark. On a device set
to the other one the first frame opens in the snapshot's colours and
`theme.appearance` says which those are, so nothing reads as the opposite
of what is on screen. It lasts until the fetch answers. Take both and pass
whichever matches the device, or pin the brand with `appearance`, if that
first frame matters.

A snapshot is a json file imported like any other, so it is already in
memory before anything renders. Take one with `designless-snapshot` and
pass it in:

```tsx
import snapshot from "./brand.snapshot.json";

<DesignlessProvider publicId="r_XXXX" snapshot={snapshot}>
```

It is a copy, so it goes stale. The file records when it was taken, a
development build says so when it is old, and check mode fails a build
when the committed file is no longer the brand that is published:

```sh
npx designless-snapshot --brand=r_XXXX --check
```

Storage is anything the app already uses. This package does not pick one:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";

createBrand({ publicId: "r_XXXX", storage: AsyncStorage });
```

A saved copy carries the brand and never a claim about what is in the app
binary. What the build contains is a fact about the build, and a saved
copy outlives the build that wrote it.

## Options

```ts
createBrand({
  publicId: "r_XXXX",   // required
  snapshot,             // a copy taken at build time
  storage,              // any key-value store with getItem and setItem
  appearance: "dark",   // leave it out to follow the device, and keep following
  remBase: 16,          // the root size a rem is measured against
  fonts: { roles: "body" },
  live: { enabled: true, activate: "next-foreground", pollMs: 300000 },
  fetchTimeoutMs: 10000,
  autoInit: true,
});
```

`fonts.present` is left out here on purpose. Leaving it out is what lets
the snapshot say what the build contains, which is the arrangement the
font command sets up for you.

## The theme

`tokens()` returns values in the units React Native reads, not the units
they were published in.

- `color` flattened to dotted keys: `theme.color["bg.page"]`
- `space`, `radius`, `size`, `opacity`, `zIndex` numbers
- `border` widths as numbers, styles as the words the brand published
- `shadow` objects React Native draws, minus what this platform lacks
- `motion.duration` in milliseconds, `motion.easing` as curves
- `spacing.touchTargetMin` and `spacing.safeArea` as published. A brand may
  publish a touch target under the platform minimum, which is 44 points on
  iOS and 48 on Android. It is passed through rather than raised, and a
  development build says so. `safeArea` is a published length and
  knows nothing about a notch or a home indicator. If your app already
  reads real insets from the system, prefer those.
- `text(spec)` the only supported way to build a text style. Line heights
  and letter spacings are published relative to the font size and are
  multiplied out here. Handing either one straight to React Native gives a
  line box a point and a half tall, and throws nothing.
- `served` the payload exactly as it arrived, for anything the theme above
  does not carry. The values there are not points.
- `appearance` which appearance the values in this theme actually are. Not
  always the one the device is on: a snapshot holds the appearance it was
  taken in, and a move between the two keeps the old label until the new
  values land. Reading it rather than the device is what keeps a status
  bar, a keyboard or a map from being set the opposite way to the screen.

## Brand marks

```tsx
import { BrandImage } from "@designless/react-native";

<BrandImage role="logo-symbol" pt={40} />
```

`pt` is worked out from the screen density and rounded up to the next size
the brand is served at. `size` asks for one exactly, checked when the app
is built rather than when the request goes out. Either way the mark
follows the appearance the brand is painting, and a mounted `BrandImage`
moves with it when the device does. It follows the colours on the screen
and not the appearance that has been asked for, so a request that has not
landed yet, or that failed offline, leaves the mark on the appearance the
rest of the screen is still on. Pass `appearance` to pin it instead.

Either way it is also given something to draw at: React Native gives a
network image no size of its own, so a mark with neither takes up no room
and shows nothing. `pt` draws at that many points, `size` draws at the
points that put one image pixel on one screen pixel, and a `style` with a
width and a height overrides both.

`brand.asset(role, params)` gives the address if you would rather draw it
yourself, and `brand.prefetchAsset(role, params)` warms the image cache.

## Status

```ts
brand.status; // "cold" | "restored" | "ready" | "stale" | "failed"
```

`hasTheme(status)` is true whenever there is something to paint with:
`restored` is a snapshot or a stored copy, `ready` is a copy fetched this
run, and `stale` is an older copy still in use after a failed fetch.


`init()` never rejects: a brand that cannot reach the network is a
degraded brand, not an exception, and the status says so. `refresh()` does
reject, because the app asked for it by hand and should be told why it did
not happen.

What it rejects with is a `BrandError`, and its `code` is the field to
branch on. Every answer that came back carries a code that says what kind
of answer it was: `bad_request`, `unauthorized`, `plan`, `forbidden`,
`not_found`, `too_many_requests`, `not_implemented`, `refused` for a
refusal with no more specific word, and `server` for a fault. `timeout`
and `network` mean nothing came back at all, and `malformed` means
something did and would not read. Only the last three and `server` are
asked for again: everything else is an answer, and `too_many_requests` is
the one where asking again is worse than useless. `retryAfterMs` carries
how long the server asked to be left alone when it said, and is null when
it did not.

## What this package does not do

- It does not add fonts at runtime. React Native core has no way to, and
  the libraries that do are yours to call, not this package's.
- It does not carry brand values, so a brand change never needs a release
  of this package.
- It does not assemble style objects out of component values. The published
  names describe a border side and a padding axis, and guessing which React
  Native property each one belongs to would be inventing intent. Numbers
  come out, assembly is yours.

## License

Apache-2.0. Copyright 2026 Designless Private Limited. [designless.io](https://designless.io)
