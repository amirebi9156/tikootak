import { colorFor, initial } from '../lib/format.js';

export default function Avatar({ id, name, size = 44, speaking = false }) {
  return (
    <span
      className={`avatar${speaking ? ' speaking' : ''}`}
      style={{ width: size, height: size, background: colorFor(id || name), fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {initial(name)}
    </span>
  );
}
