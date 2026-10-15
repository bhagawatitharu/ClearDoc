const STOP_WORDS = new Set(
  "a an and are as at be been being but by can could did do does for from had has have he her hers him his how i if in into is it its may me might more most my no not of on or our ours she should so than that the their theirs them then there these they this those through to too up us very was we were what when where which who will with would you your".split(" "),
);

const WORD_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}'’-]{1,}/gu;
const SENTENCE_PATTERN = /[^.!?。！？\n]+[.!?。！？]?/gu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ACTION_PATTERN = /\b(?:action item|todo)\b|\b(?:must|need to|needs to|required to|is required to|are required to|please)\b|\bshould\s+(?:not|always|never)\b|\b(?:will|should)\s+(?:collect|submit|confirm|measure|prepare|send|review|record|obtain|ask|notify|post|update|place|install|order|contact|schedule|report|verify|publish|invite|compare|keep|maintain|check|approve|call|sign|pay|file|deliver|return|reply|respond|follow[ -]up|ensure|provide|attend|reserve|remove|set up|cancel|renew|photograph|pause|begin|start|finish|close|reopen|train|use|identify|be\s+(?:posted|scheduled|kept|filled|completed|submitted|provided|approved|reported))\b/i;
const DATE_PATTERN = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b(?:today|tomorrow|yesterday|this\s+(?:week|month)|next\s+(?:week|month)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const DEADLINE_PATTERN = /\b(?:deadline|due(?:\s+(?:date|by|on))?|no later than|within\s+\d+\s+(?:business\s+)?(?:day|week|month)s?)\b/i;
const FIGURE_PATTERN = /(?:[$€£]\s*\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?\s?%|\b(?:budget|cost|fee|price|amount|total|quantity|minimum|maximum|capacity|rate|hours?|days?|weeks?|months?|years?|volunteers?|shifts?|units?|bags?)\s*(?:of|is|was|are|:)?\s*\d[\d,]*(?:\.\d+)?\b)/i;
const PHONE_PATTERN = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/;
const CONTACT_PATTERN = new RegExp(`${EMAIL_PATTERN.source}|${PHONE_PATTERN.source}`, "i");
const OWNER_ACTION_PATTERN = /\b[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)?\s+(?:will|must|should|needs to)\b/u;
const OBLIGATION_PATTERN = /\b(?:must|need to|needs to|required to|deadline|no later than)\b/i;
const SCHEDULED_DATE_PATTERN = /\b(?:target|scheduled|begins?|starts?|reopening|opening|inspection|milestone)\b/i;
const DATE_METADATA_PATTERN = /^(?:prepared|issued|created|printed|report date|document date)\b/i;
const DECISION_PATTERN = /\b(?:decision|decided|agreed|approved|selected|chosen|confirmed|resolution|conclusion)\b/i;
const MAX_CATEGORY_ITEMS = 4;

function getKeywords(sentence) {
  return (sentence.toLocaleLowerCase().match(WORD_PATTERN) || []).filter(
    (word) => !STOP_WORDS.has(word),
  );
}

function splitLongSentence(sentence, maxLength = 520) {
  if (sentence.length <= maxLength) return [sentence];

  const fragments = [];
  let fragment = "";

  for (const word of sentence.split(/\s+/)) {
    const next = fragment ? `${fragment} ${word}` : word;

    if (next.length > maxLength && fragment) {
      fragments.push(`${fragment}…`);
      fragment = word;
    } else {
      fragment = next;
    }
  }

  if (fragment) fragments.push(fragment);
  return fragments;
}

function getSentences(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .flatMap((line) => {
      const protectedLine = line.replace(EMAIL_PATTERN, (email) =>
        email.replace(/\./g, "\uE000"),
      );
      return protectedLine.match(SENTENCE_PATTERN) || [protectedLine];
    })
    .map((sentence) => sentence.replace(/\uE000/g, "."))
    .map((sentence) => sentence.replace(/^\s*(?:[-*•▪]\s+|\d+[.)]\s+)/, "").trim())
    .filter(Boolean)
    .flatMap((sentence) => splitLongSentence(sentence));
}

function overlapRatio(first, second) {
  const smaller = first.size <= second.size ? first : second;
  const larger = smaller === first ? second : first;
  let shared = 0;

  for (const word of smaller) {
    if (larger.has(word)) shared += 1;
  }

  return smaller.size ? shared / smaller.size : 0;
}

function selectMatchingSentences(
  sentences,
  pattern,
  limit = MAX_CATEGORY_ITEMS,
  priorityPatterns = [],
  excludedPattern = null,
) {
  return sentences
    .map((sentence, index) => ({
      sentence,
      index,
      priority: priorityPatterns.reduce(
        (score, item) => score + (item.pattern.test(sentence) ? item.weight : 0),
        0,
      ),
    }))
    .filter(
      (entry) =>
        pattern.test(entry.sentence) &&
        !isLikelyHeading(entry.sentence) &&
        !(excludedPattern?.test(entry.sentence) ?? false),
    )
    .sort((first, second) => second.priority - first.priority || first.index - second.index)
    .slice(0, limit)
    .sort((first, second) => first.index - second.index)
    .map((entry) => entry.sentence);
}

function isLikelyHeading(sentence) {
  return /^(?:notice|project brief|team meeting notes|meeting notes|agenda|subject|purpose)\b/i.test(sentence);
}

function selectKeyPoints(sentences, limit = 4) {
  if (!sentences.length) return [];

  const sentenceKeywords = sentences.map(getKeywords);
  const frequencies = new Map();

  for (const words of sentenceKeywords) {
    for (const word of words) {
      frequencies.set(word, (frequencies.get(word) || 0) + 1);
    }
  }

  const rankedSentences = sentences
    .map((sentence, index) => {
      const keywords = sentenceKeywords[index];
      const score = keywords.length
        ? keywords.reduce(
            (total, word) => total + Math.log2(frequencies.get(word) + 1),
            0,
          ) / Math.sqrt(keywords.length)
        : 0;
      const usefulDetailBoost =
        (ACTION_PATTERN.test(sentence) ? 0.8 : 0) +
        (DATE_PATTERN.test(sentence) || DEADLINE_PATTERN.test(sentence) ? 0.7 : 0) +
        (FIGURE_PATTERN.test(sentence) ? 0.6 : 0) +
        (DECISION_PATTERN.test(sentence) ? 0.6 : 0);
      const positionBoost = 1 + (1 - index / sentences.length) * 0.06;

      return {
        sentence,
        index,
        keywords: new Set(keywords),
        score: (score + usefulDetailBoost) * positionBoost,
      };
    })
    .filter((entry) => !isLikelyHeading(entry.sentence))
    .sort((first, second) => second.score - first.score || first.index - second.index);

  const selected = [];

  for (const candidate of rankedSentences) {
    if (candidate.keywords.size < 2 && sentences.length > 2) continue;

    const isRepetitive = selected.some(
      (entry) => overlapRatio(candidate.keywords, entry.keywords) >= 0.78,
    );

    if (!isRepetitive) selected.push(candidate);
    if (selected.length === limit) break;
  }

  if (!selected.length) {
    return sentences
      .filter((sentence) => !isLikelyHeading(sentence))
      .slice(0, limit);
  }

  return selected
    .sort((first, second) => first.index - second.index)
    .map((entry) => entry.sentence);
}

/**
 * Finds likely useful passages using lightweight local text rules. It keeps
 * source wording intact and never sends document text to an online service.
 */
export function createQuickSummary(text) {
  if (!text?.trim()) {
    return {
      keyPoints: [],
      actionItems: [],
      datesAndDeadlines: [],
      keyFigures: [],
      contacts: [],
    };
  }

  const sentences = getSentences(text);

  return {
    keyPoints: selectKeyPoints(sentences),
    actionItems: selectMatchingSentences(
      sentences,
      ACTION_PATTERN,
      MAX_CATEGORY_ITEMS,
      [
        { pattern: OWNER_ACTION_PATTERN, weight: 5 },
        { pattern: DATE_PATTERN, weight: 3 },
        { pattern: DEADLINE_PATTERN, weight: 3 },
        { pattern: OBLIGATION_PATTERN, weight: 1 },
      ],
    ),
    datesAndDeadlines: selectMatchingSentences(
      sentences,
      new RegExp(`${DATE_PATTERN.source}|${DEADLINE_PATTERN.source}`, "i"),
      MAX_CATEGORY_ITEMS,
      [
        { pattern: DATE_PATTERN, weight: 8 },
        { pattern: DEADLINE_PATTERN, weight: 5 },
        { pattern: OWNER_ACTION_PATTERN, weight: 4 },
        { pattern: SCHEDULED_DATE_PATTERN, weight: 2 },
      ],
      DATE_METADATA_PATTERN,
    ),
    keyFigures: selectMatchingSentences(sentences, FIGURE_PATTERN),
    contacts: selectMatchingSentences(sentences, CONTACT_PATTERN),
  };
}
