A live loop machine for a few friends and some strange instruments.

Try it on https://jam.0sk.ar

---

Everyone sits at one dial. A seat is a ring, a ring is an instrument. You draw and the drawing plays. The hand sweeps round them all on one shared clock. Robots are off unless you want help.

It is meant to be **malleable**. Press `d` and the machine opens up: tempo, meter, key and chords, which instrument sits in which ring and every one of its knobs. All of it changes live, mid-jam, for everyone. Controls aren't a developer backstage; they're part of the instrument.

And the instruments are **creative**, in the sense that each one is a different idea of what drawing a sound could mean. There are 15 across four groups (beat, low, chords, tune), with more to come.

## Words

- **seat**: a place at the machine.
- **ring**: what's drawn on the dial for a seat. Only a picture.
- **instrument**: a gesture plus its sound.
- **voice**: the sound alone.
- **erase** rubs out under the pen; **wipe** clears your whole ring.
- **loud** is one note's level; **level** is an instrument's volume. **range** is pitch spread, **decay** is tail length.

## Play

Run `python3 -m http.server` and open <http://localhost:8000> to play across tabs.

[Run a relay](sync/README.md) to play across machines.

## Deploy

CI runs `cf deploy` on every push to `main`.

## Inside

The machine is in [src/](src/); the way we work on it is in [AGENTS.md](AGENTS.md).

### Write an instrument

Run `pnpm new-instrument <name>`; see the [instrument contract](src/instruments/README.md).
