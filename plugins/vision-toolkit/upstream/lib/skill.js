/**
 * DSH-native adapter for the upstream vision-tools Skill and playbooks.
 * @module dsh-vision-toolkit/skill
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/** Stable catalog/invocation name shared with progressive tool exposure. */
export const VISION_SKILLS_NAME = 'vision-skills';
/** Packaged resource root for the adapted upstream playbooks. */
export const VISION_SKILLS_RESOURCE_BASE = fileURLToPath(new URL('../assets/skill/', import.meta.url));
/** Exact bundled instructions used as the progressive-exposure evidence marker. */
export const VISION_SKILLS_CONTENT = readFileSync(new URL('../assets/skill/SKILL.md', import.meta.url), 'utf8');
/** Runtime skill registration mounted only after every native tool is ready. */
export const VISION_SKILLS_SKILL = {
    name: VISION_SKILLS_NAME,
    description: 'Restore a UI (a web page, an app screen, or a component) from a screenshot or design mock, producing HTML/CSS or code in the project\'s existing frontend; also supports image Q&A, OCR of long screenshots and chat logs, element grounding and inventory, cropping, foreground extraction, pixel diff, colour picking, SVG tracing, and HTML-to-screenshot. Use when the task involves understanding an image, rebuilding or restoring a UI from a screenshot, visual regression, pixel coordinates, screenshot-driven GUI actions, reusable image or SVG assets, chart reconstruction, or OCR of a long screenshot.',
    whenToUse: 'Use when the task depends on text or content inside an image, pixel coordinates, rebuilding a UI from a screenshot, visual regression, reusable image or SVG assets, chart reconstruction, screenshot-driven GUI actions, or OCR of a long screenshot.',
    source: 'runtime',
    resourceBase: {
        kind: 'directory',
        path: VISION_SKILLS_RESOURCE_BASE,
    },
    content: VISION_SKILLS_CONTENT,
};
//# sourceMappingURL=skill.js.map