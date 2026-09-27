import { catalog } from "./catalog.js";
import { prepareParserCatalog, type ParserCatalog } from "./catalogIndex.js";

/**
 * The 482-product base seed, prepared for Layer 1. **Tests, eval and scripts
 * only** (KB-302, owner Q2): app code parses against the SHOP's catalog
 * (data/shopCatalog.ts, D4). Kept in its own module so no production file
 * imports it by accident - VERIFY greps src/ for importers - and so its index
 * isn't built at app start.
 */
export const SEED_PARSER_CATALOG: ParserCatalog = prepareParserCatalog(catalog);
