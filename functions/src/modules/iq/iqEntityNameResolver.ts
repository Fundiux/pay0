// H4_D85_A10_A39_CANONICAL_IQ_CLIENT_LINK
export type IqEntityRow = {
  id?: unknown;
  name?: unknown;
  value?: unknown;
};

export type IqEntityResolution = {
  id: string;
  name: string;
  method:
    | "EXACT_NORMALIZED"
    | "DISTINCTIVE_EXACT"
    | "DISTINCTIVE_CONTAINS"
    | "CLOSEST_UNIQUE";
  score: number;
  targetNormalized: string;
  selectedNormalized: string;
};

const COMMON_WORDS = new Set([
  "administracion",
  "administradora",
  "aplicadas",
  "capital",
  "comercializadora",
  "comercial",
  "constructora",
  "construcciones",
  "corporativo",
  "de",
  "del",
  "empresa",
  "grupo",
  "integral",
  "la",
  "las",
  "los",
  "mexico",
  "municipio",
  "nl",
  "para",
  "responsabilidad",
  "servicios",
  "sociedad",
  "soluciones",
  "variable",
]);

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeIqEntityName(
  value: unknown,
): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function distinctiveIqTokens(
  value: unknown,
): string[] {
  return normalizeIqEntityName(value)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 3 &&
        !COMMON_WORDS.has(token),
    );
}

function levenshtein(a: string,b: string): number {
  const rows=a.length+1;
  const cols=b.length+1;
  const matrix=Array.from(
    {length:rows},
    ()=>Array(cols).fill(0),
  );

  for(let i=0;i<rows;i+=1)matrix[i][0]=i;
  for(let j=0;j<cols;j+=1)matrix[0][j]=j;

  for(let i=1;i<rows;i+=1){
    for(let j=1;j<cols;j+=1){
      const cost=a[i-1]===b[j-1]?0:1;
      matrix[i][j]=Math.min(
        matrix[i-1][j]+1,
        matrix[i][j-1]+1,
        matrix[i-1][j-1]+cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function scoreName(
  target: string,
  candidate: string,
): {
  score: number;
  method: IqEntityResolution["method"];
} {
  const targetNormalized=normalizeIqEntityName(target);
  const candidateNormalized=normalizeIqEntityName(candidate);

  if(!targetNormalized||!candidateNormalized){
    return {score:0,method:"CLOSEST_UNIQUE"};
  }

  if(targetNormalized===candidateNormalized){
    return {score:1000,method:"EXACT_NORMALIZED"};
  }

  const targetTokens=distinctiveIqTokens(target);
  const candidateTokens=distinctiveIqTokens(candidate);
  const targetKey=targetTokens.join(" ");
  const candidateKey=candidateTokens.join(" ");

  if(targetKey&&targetKey===candidateKey){
    return {score:950,method:"DISTINCTIVE_EXACT"};
  }

  if(
    targetKey.length>=4 &&
    candidateKey.length>=4 &&
    (
      targetKey.includes(candidateKey) ||
      candidateKey.includes(targetKey)
    )
  ){
    return {score:900,method:"DISTINCTIVE_CONTAINS"};
  }

  const targetSet=new Set(targetTokens);
  const candidateSet=new Set(candidateTokens);
  const shared=targetTokens.filter(
    token=>candidateSet.has(token),
  );
  const union=new Set([
    ...targetTokens,
    ...candidateTokens,
  ]);

  const overlap=union.size>0
    ? shared.length/union.size
    : 0;

  const distance=levenshtein(
    targetKey||targetNormalized,
    candidateKey||candidateNormalized,
  );

  const maxLength=Math.max(
    (targetKey||targetNormalized).length,
    (candidateKey||candidateNormalized).length,
    1,
  );

  const closeness=1-distance/maxLength;
  const score=Math.round(
    overlap*600+Math.max(0,closeness)*250,
  );

  return {
    score,
    method:"CLOSEST_UNIQUE",
  };
}

export function resolveUniqueIqEntity(
  rows: IqEntityRow[],
  targetName: string,
): IqEntityResolution {
  const scored=rows
    .map(row=>{
      const name=cleanText(row.name??row.value??row.id);
      const id=cleanText(row.id??row.value);
      const match=scoreName(targetName,name);
      return {id,name,...match};
    })
    .filter(
      row=>row.id&&row.name&&row.score>0,
    )
    .sort((a,b)=>b.score-a.score);

  if(scored.length===0){
    throw new Error(
      `IQ_ENTITY_NOT_FOUND:${cleanText(targetName)}`,
    );
  }

  const best=scored[0];
  const second=scored[1];

  if(best.score<700){
    throw new Error(
      `IQ_ENTITY_LOW_CONFIDENCE:${cleanText(targetName)}:${best.score}`,
    );
  }

  if(
    second &&
    best.score-second.score<100
  ){
    throw new Error(
      `IQ_ENTITY_AMBIGUOUS:${cleanText(targetName)}:${best.name}:${second.name}`,
    );
  }

  return {
    id:best.id,
    name:best.name,
    method:best.method,
    score:best.score,
    targetNormalized:normalizeIqEntityName(targetName),
    selectedNormalized:normalizeIqEntityName(best.name),
  };
}
