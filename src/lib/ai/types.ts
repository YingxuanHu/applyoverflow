export type FitAnalysis = {
  score: number;
  tier: "strong" | "good" | "moderate" | "weak";
  summary: string;
  strengths: string[];
  gaps: string[];
  keywords: string[];
  profileNotice?: string | null;
};

export type CoverLetterResult = {
  text: string;
  wordCount: number;
  profileNotice?: string | null;
};
