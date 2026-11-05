import { CONNECTION_PARSER_VERSION } from '../connections/importer.js';
import { GRAMMAR_ADMISSION_VERSION } from '../grammar/admission.js';
import { CONNECTOR_GRAMMAR_VERSION, CONNECTOR_SCHEMA_VERSION } from '../grammar/schema.js';
import { CONNECTOR_INGESTION_VERSION } from '../grammar/sources.js';

export const MODULE_ASSEMBLY_VERSION = 'source-module-assembly-2-ranked-support';
export const modulePolicy = () => ({ module: MODULE_ASSEMBLY_VERSION, validationSuite: 'source-module-suite-2-multipoint-composition', parser: CONNECTION_PARSER_VERSION,
  admission: GRAMMAR_ADMISSION_VERSION, schema: CONNECTOR_SCHEMA_VERSION, grammar: CONNECTOR_GRAMMAR_VERSION, ingestion: CONNECTOR_INGESTION_VERSION });
