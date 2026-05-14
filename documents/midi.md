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
2. Click **LEARN**.
3. Move the knob or fader you want to use on your controller.
4. From the dropdown, pick the parameter to map.

That's it. Move the same knob now and the mapped parameter moves with it. The mapping list under **LEARN** shows every active binding, sorted by CC number.

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
| Color Scheme | 0 – 35 | Integer; quantized to 36 palettes |
| Auto-Rotate Speed | 0 – 0.002 | Slow orbit speed |

CC values 0–127 are linearly mapped to the parameter range. For integer parameters (Color Scheme), the value is rounded to the nearest valid index.

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
- For performance, bind **Amplitude** to a fader on your master MIDI controller and pull it down to neutralize the visualization between songs. Same idea as an output trim.
- Mappings persist per browser. If you use VIMATHIC on a second machine, you'll need to remap (or export/import the localStorage key `vimathic_midi_map`).

## Troubleshooting

- **Badge stays grey.** MIDI permission denied or browser doesn't support Web MIDI. Check the lock icon in the address bar to re-grant.
- **Controller connects but knobs do nothing.** Your controller might send Note-On / Note-Off or NRPN instead of plain CC — VIMATHIC only listens for CC. Check the controller's settings for "CC mode".
- **Some knobs work, others don't.** Different CC numbers from the same controller — open Learn mode and bind them individually.
