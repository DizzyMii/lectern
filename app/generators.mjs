// Canned prompts that turn the notebook into a note.
const CITE = 'Cite every claim with the citation forms from the system prompt.';

export const GENERATORS = {
  'study-guide': {
    title: 'Study guide',
    prompt: `Write a study guide for this notebook. Start with a short overview of what the sources cover, then one section per major topic with the key ideas, the main classes and methods involved, and a few self-check questions at the end of each section. ${CITE}`,
  },
  faq: {
    title: 'FAQ',
    prompt: `Write an FAQ of the 15 questions a mod developer is most likely to ask about these sources, each with a short, concrete answer and a code snippet where it helps. ${CITE}`,
  },
  'cheat-sheet': {
    title: 'Cheat sheet',
    prompt: `Write a dense one-page cheat sheet: registration, events, networking, data storage, client vs server, with the exact class and method names and minimal code snippets. Use tables where they help. ${CITE}`,
  },
  'porting-guide': {
    title: 'Porting guide',
    prompt: `Write a porting guide for moving a mod from older Forge or NeoForge versions (1.20.x) to this version. Use the primers and docs. List each breaking change with before and after code, grouped by area, and finish with a checklist. ${CITE}`,
  },
  glossary: {
    title: 'Glossary',
    prompt: `Write an alphabetical glossary of the terms, classes and concepts in these sources, one or two sentences each. ${CITE}`,
  },
  gotchas: {
    title: 'Gotchas',
    prompt: `List the gotchas: the mistakes, surprising behaviours, side-specific traps and easy-to-miss requirements that these sources warn about or imply. For each, say what goes wrong, why, and the fix. ${CITE}`,
  },
};

export function listGenerators() {
  return Object.entries(GENERATORS).map(([kind, g]) => ({ kind, title: g.title }));
}
