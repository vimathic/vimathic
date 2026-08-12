---
title: MIDI
order: 3
group: getting-started
description: Map any hardware MIDI controller to any VIMATHIC parameter using one-tap Learn mode.
---

# MIDI Setup

VIMATHIC reads MIDI Control Change (CC) messages from any USB or Bluetooth MIDI controller. You can map any CC to any tweakable parameter — color scheme, amplitude, wave intensity, bloom, bass/treble sensitivity, auto-rotate speed. Mappings are saved to your browser's `localStorage` and survive page reloads.

## Browser requirements

MIDI uses the **Web MIDI API**, which is supported in **Chrome and Edge** on desktop and Android. Firefox and Safari do not implement Web MIDI. If you're on an unsupported browser, the MIDI badge in the panel stays grey and there's nothing further to do here.

## Plugging in a controller

1. Connect your controller (USB or Bluetooth MIDI).
2. Reload VIMATHIC.
3. The browser asks for MIDI permission — click **Allow**.
4. The MIDI badge in the panel turns green and shows `🎹 MIDI: 1` (or however many devices are connected).

If you connect a controller after the page is loaded, VIMATHIC picks it up automatically — the badge count updates within a second.

## Learn mode — the fast way

Learn mode binds the next incoming CC message to a parameter of your choice.

1. Open the **MIDI** section in the control panel.
2. In the empty row at the bottom of the mapping list, pick the parameter from the dropdown.
3. Click **⊙ LEARN** on that row — it starts listening.
4. Move the knob or fader you want to use.

That's it. Move the same control now and the parameter moves with it. The mapping list shows every active binding, sorted by CC number, and each row has its own **⊙** to re-learn it onto a different control.

The panel's **🎛 LEARN MODE** button is a reminder rather than a step: pressed on its own it just tells you to use the row's ⊙, and pressed while a row is listening it cancels.

## REL and ABS

Each row carries a mode badge you can click:

- **REL** — relative. The controller sends ticks and each one nudges the value from wherever it is. This is what a new mapping starts as, because endless encoders are the common case and a relative binding never jumps a value on the first touch.
- **ABS** — absolute. The controller's position *is* the value, mapped linearly across the parameter range. This is what a potentiometer or a fader wants: its physical position should mean something.

Set the badge to match the hardware. A fader left in REL is read as a stream of ticks, so its position stops meaning anything: the top half of its travel is decoded as a large negative delta and pushes the parameter the wrong way.

## Manual mapping

If your controller sends predictable CC numbers, you can also map without Learn mode — just pick the parameter from the dropdown next to a CC number in the mapping list. Setting it to **— Unassigned —** removes the mapping.

## What you can map

Every parameter that has a slider in the panel is mappable, plus a few that aren't bound to UI:

| Parameter | Range | Notes |
|---|---|---|
| Amplitude | 0.2 – 1.5 | Overall displacement strength |
| Wave Intensity | 0.3 – 3.5 | Detail / harmonics scaling |
| Bass Sensitivity | 0 – 2.5 | How much bass moves the geometry |
| Treble Sensitivity | 0 – 2.5 | How much treble brightens edges |
| Bloom | 0 – 1.5 | Post-process bloom strength |
| Color Scheme | 0 – 43 | Integer; quantized to 44 palettes |
| Auto-Rotate Speed | 0 – 0.002 | Slow orbit speed |

In **ABS** mode, CC values 0–127 are mapped linearly across the parameter range. In **REL** mode the incoming byte is a signed tick count and the range only sets the step size. For integer parameters (Color Scheme), the value is rounded to the nearest valid index, and that one wraps rather than sticking at either end.

## Bluetooth MIDI

Bluetooth MIDI works the same way as USB MIDI, but the OS-level pairing happens outside VIMATHIC:

- **macOS:** Audio MIDI Setup → MIDI Studio → Bluetooth.
- **Windows:** Settings → Devices → Add Bluetooth (modern Windows builds expose Bluetooth MIDI directly to Chrome).
- **iPad/iPhone:** any BLE-MIDI app, then VIMATHIC sees the iPad as a MIDI device.

Latency on Bluetooth is usually fine for slow knob movements; for fast performance use you may prefer USB.

## Clear / reset

The **CLEAR** button in the MIDI section removes all mappings at once. There is no per-mapping undo — clear and re-learn if you make a mistake.

## Tips

- Bind the **Color Scheme** parameter to a button or pad — even though it's a continuous CC, the quantization means a single tap on a velocity-sensitive pad cleanly steps through palettes.
- Bind **Bass Sensitivity** and **Treble Sensitivity** to two knobs on the same row. Together they give you a quick "EQ tilt" feel during a set.
- For performance, bind **Amplitude** to a fader on your master MIDI controller and pull it down to neutralize the visualization between songs — same idea as an output trim. Switch that row to **ABS** first: in REL the fader's position is read as ticks, and pulling it down drives amplitude *up*.
- Mappings persist per browser. If you use VIMATHIC on a second machine, you'll need to remap (or export/import the localStorage key `vimathic_midi_map`).

## Troubleshooting

- **Badge stays grey.** MIDI permission denied or browser doesn't support Web MIDI. Check the lock icon in the address bar to re-grant.
- **Controller connects but knobs do nothing.** Your controller might send Note-On / Note-Off or NRPN instead of plain CC — VIMATHIC only listens for CC. Check the controller's settings for "CC mode".
- **Some knobs work, others don't.** Different CC numbers from the same controller — open Learn mode and bind them individually.
