import { BUILDS, HAIR_COLORS, HAIR_LABELS, HAIR_STYLES, OUTFITS, OUTFIT_COLORS, OUTFIT_LABELS, SKIN_TONES } from '@nukkad/shared';
import type { AvatarLook } from '@nukkad/shared';

interface Props {
  look: AvatarLook;
  onChange: (change: Partial<AvatarLook>) => void;
  onClose: () => void;
}

/** A row of round colour buttons. */
function Swatches(props: { label: string; colors: readonly string[]; value: number; onPick: (index: number) => void }) {
  return (
    <div className="row">
      <span className="rowLabel">{props.label}</span>
      <div className="swatches">
        {props.colors.map((color, index) => (
          <button
            key={color}
            type="button"
            className={index === props.value ? 'swatch picked' : 'swatch'}
            style={{ background: color }}
            aria-label={`${props.label} ${index + 1}`}
            aria-pressed={index === props.value}
            onClick={() => props.onPick(index)}
          />
        ))}
      </div>
    </div>
  );
}

/** A row of word buttons. */
function Choices(props: { label: string; names: string[]; value: number; onPick: (index: number) => void }) {
  return (
    <div className="row">
      <span className="rowLabel">{props.label}</span>
      <div className="choices">
        {props.names.map((name, index) => (
          <button
            key={name}
            type="button"
            className={index === props.value ? 'choice picked' : 'choice'}
            aria-pressed={index === props.value}
            onClick={() => props.onPick(index)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The "make it yours" panel: skin, hair, outfit, colour. Every option is open to everyone. */
export function AvatarPanel({ look, onChange, onClose }: Props) {
  const set = (field: keyof AvatarLook) => (index: number) => onChange({ [field]: index });
  return (
    <section className="panel" aria-label="Your look">
      <header>
        <h2>Your look</h2>
        <button type="button" className="close" onClick={onClose}>
          Done
        </button>
      </header>
      <Choices label="Build" names={[...BUILDS]} value={look.build} onPick={set('build')} />
      <Swatches label="Skin" colors={SKIN_TONES} value={look.skin} onPick={set('skin')} />
      <Choices label="Hair" names={HAIR_STYLES.map((style) => HAIR_LABELS[style])} value={look.hair} onPick={set('hair')} />
      <Swatches label="Hair colour" colors={HAIR_COLORS} value={look.hairColor} onPick={set('hairColor')} />
      <Choices label="Outfit" names={OUTFITS.map((outfit) => OUTFIT_LABELS[outfit])} value={look.outfit} onPick={set('outfit')} />
      <Swatches label="Colour" colors={OUTFIT_COLORS} value={look.color} onPick={set('color')} />
    </section>
  );
}
