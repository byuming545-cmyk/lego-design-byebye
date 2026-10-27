export interface InstructionDocument {
  id: string;
  fileName: string;
  status: 'ready' | 'transfer-limit';
  setNumber: string | null;
  pages?: number | null;
  sha256?: string | null;
  appendixPages?: number[];
  [key: string]: unknown;
}

const REQUESTED_SETS = [
  { setNumber: '77263', requestedName: 'BMW M3 (E30)', vehicleType: 'classic-coupe' },
  { setNumber: '76924', requestedName: 'Mercedes-AMG G 63 & Mercedes-AMG SL 63', vehicleType: 'suv-and-roadster' },
  { setNumber: '77239', requestedName: 'Porsche 911 GT3 RS', vehicleType: 'sports-car' },
  { setNumber: '77238', requestedName: 'Lamborghini Revuelto & Huracán STO', vehicleType: 'supercar-pair' },
  { setNumber: '77254', requestedName: 'Ferrari SF90 XX Stradale', vehicleType: 'supercar' },
  { setNumber: '77257', requestedName: 'McLaren W1', vehicleType: 'supercar' },
] as const;

/** Requested descriptions remain separate from facts established by the actual files. */
export function buildReferenceSetRecords(documents: InstructionDocument[]) {
  return REQUESTED_SETS.map(set => {
    const local = documents.filter(document => document.status === 'ready' && document.setNumber === set.setNumber);
    return {
      ...set,
      setId: set.setNumber,
      setName: null,
      name: null,
      nameBasis: 'user-requested; not independently verified product metadata',
      officialUrl: null,
      instructionsUrl: `https://www.lego.com/en-us/service/buildinginstructions/${set.setNumber}`,
      instructionsUrlStatus: 'target-only; cloud access previously blocked',
      year: null,
      pieceCount: null,
      officialDescription: null,
      designFeatures: [] as string[],
      vehicleTypeBasis: 'user-requested classification',
      sourceStatus: local.length ? 'local-instructions' : 'missing-local-material',
      officialWebsiteStatus: 'blocked',
      status: local.length ? 'local-instructions' : 'missing-local-material',
      instructionCount: local.length,
      documentIds: local.map(document => document.id),
      inventoryComplete: false,
    };
  });
}
