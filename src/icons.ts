import { createRequire } from "node:module";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { getIconData, iconToSVG, quicklyValidateIconSet } from "@iconify/utils";
import { ICONS_CONFIG_FILE } from "./options";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MARKER =
  /^\{% comment %\} vite-plugin-shopify-theme:icon:v1 ([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*) \{% endcomment %\}\r?\n/;

/** Resolve all inputs and conflicts before changing any output in the locked Theme Target. */
export function generateIcons(
  themePath: string,
  root = themePath,
): { written: number; removed: number } {
  const configPath = join(themePath, ICONS_CONFIG_FILE);
  let selection: unknown;
  try {
    selection = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`[shopify-theme:icons] Cannot read ${configPath}: ${(error as Error).message}`);
  }
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    throw new Error(
      `[shopify-theme:icons] ${configPath} must map collection names to icon name arrays.`,
    );
  }

  const collections = Object.entries(selection).sort(([a], [b]) => a.localeCompare(b));
  for (const [collection, names] of collections) {
    if (
      !NAME.test(collection) ||
      !Array.isArray(names) ||
      names.some((name) => typeof name !== "string" || !NAME.test(name))
    ) {
      throw new Error(
        `[shopify-theme:icons] Invalid selection for ${collection} in ${configPath}; use collection names and arrays of kebab-case icon names.`,
      );
    }
  }

  // A Theme Target may live outside Vite root; icon dependencies belong to the host toolchain.
  const require = createRequire(join(root, "package.json"));
  const desired = new Map<string, string>();
  for (const [collection, names] of collections) {
    const selected = [...new Set(names as string[])].sort();
    if (!selected.length) continue;
    const packageName = `@iconify-json/${collection}`;
    let data;
    try {
      data = quicklyValidateIconSet(
        JSON.parse(readFileSync(require.resolve(`${packageName}/icons.json`), "utf8")),
      );
    } catch (error) {
      throw new Error(
        `[shopify-theme:icons] Cannot load ${packageName}. Install it in the consuming project. ${(error as Error).message}`,
      );
    }
    if (!data || data.prefix !== collection) {
      throw new Error(
        `[shopify-theme:icons] ${packageName} must contain valid Iconify data with prefix ${collection}.`,
      );
    }
    for (const name of selected) {
      const file = `icon-${collection}-${name}.liquid`;
      if (desired.has(file)) {
        throw new Error(
          `[shopify-theme:icons] Multiple icons resolve to ${file}; rename the selection to avoid a collection/name collision.`,
        );
      }
      const icon = getIconData(data, name);
      if (!icon)
        throw new Error(
          `[shopify-theme:icons] Unknown icon ${collection}:${name} in ${configPath}.`,
        );
      const svg = iconToSVG(icon);
      desired.set(file, renderSnippet(collection, name, svg.attributes.viewBox, svg.body));
    }
  }

  const directory = join(themePath, "snippets");
  const relativeDirectory = relative(realpathSync(themePath), realpathSync(directory));
  if (
    relativeDirectory === ".." ||
    relativeDirectory.startsWith(`..${sep}`) ||
    isAbsolute(relativeDirectory)
  ) {
    throw new Error(`[shopify-theme:icons] snippets/ must resolve inside the Theme Target.`);
  }
  const existing = new Map<string, string>();
  const managed = new Set<string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.name.startsWith("icon-") || !entry.name.endsWith(".liquid")) continue;
    if (!entry.isFile()) {
      if (desired.has(entry.name))
        throw new Error(`[shopify-theme:icons] Refusing to replace non-file ${entry.name}.`);
      continue;
    }
    const content = readFileSync(join(directory, entry.name), "utf8");
    existing.set(entry.name, content);
    const match = MARKER.exec(content);
    if (match && entry.name === `icon-${match[1]}-${match[2]}.liquid`) managed.add(entry.name);
  }
  for (const file of desired.keys()) {
    if (existing.has(file) && !managed.has(file)) {
      throw new Error(
        `[shopify-theme:icons] Refusing to overwrite hand-authored snippets/${file}. Move it or remove this icon from ${ICONS_CONFIG_FILE}.`,
      );
    }
  }

  let written = 0;
  let removed = 0;
  for (const [file, content] of desired) {
    if (existing.get(file) === content) continue;
    const target = join(directory, file);
    // Do not follow a newly introduced symlink when replacing an existing generated snippet.
    if (existing.has(file) && !lstatSync(target).isFile()) {
      throw new Error(`[shopify-theme:icons] Refusing to replace non-file ${file}.`);
    }
    writeFileSync(target, content);
    written++;
  }
  for (const file of managed) {
    if (desired.has(file)) continue;
    unlinkSync(join(directory, file));
    removed++;
  }
  return { written, removed };
}

function renderSnippet(collection: string, name: string, viewBox: string, source: string): string {
  // Iconify monochrome sets use presentation attributes. Keep none/opacity and original
  // geometry; reject fixed palettes/styles rather than silently changing multicolor artwork.
  if (/<(?:style|linearGradient|radialGradient|pattern)\b|\sstyle\s*=/i.test(source)) {
    throw new Error(
      `[shopify-theme:icons] ${collection}:${name} is not a monochrome presentation-attribute icon.`,
    );
  }
  const body = source
    .replace(
      /\b(fill|stroke|color)\s*=\s*(["'])(.*?)\2/gi,
      (attribute, _name: string, _quote: string, value: string) => {
        if (!/^(?:none|currentColor|inherit|transparent)$/i.test(value)) {
          throw new Error(
            `[shopify-theme:icons] ${collection}:${name} has a fixed color (${value}); choose a monochrome icon using currentColor.`,
          );
        }
        return attribute;
      },
    )
    .replace(
      /\bstroke-width\s*=\s*(["'])([\d.]+)\1/g,
      (_attribute, _quote: string, width: string) =>
        `stroke-width="{{ stroke_width | default: ${Number(width)} }}"`,
    );

  return `{% comment %} vite-plugin-shopify-theme:icon:v1 ${collection}:${name} {% endcomment %}
{% doc %}
  Generated from ${collection}:${name}. Edit ${ICONS_CONFIG_FILE}, not this file.
  @param {number} [size] - Square icon size in pixels (default 24).
  @param {number} [stroke_width] - Override the original stroke width; filled paths are unaffected.
  @param {string} [class] - Additional CSS classes.
  @example
  {% render 'icon-${collection}-${name}', size: 20, stroke_width: 1.5 %}
{% enddoc %}
<svg xmlns="http://www.w3.org/2000/svg" width="{{ size | default: 24 }}" height="{{ size | default: 24 }}" viewBox="${viewBox}" fill="currentColor" stroke-width="{{ stroke_width | default: 2 }}"{% if class != blank %} class="{{ class | escape }}"{% endif %} aria-hidden="true" focusable="false">
  ${body}
</svg>
`;
}
