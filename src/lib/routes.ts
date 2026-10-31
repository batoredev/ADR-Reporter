// Page addresses. Case pages take the case id as ?id=, because the site is
// static files: there is no server to answer /reports/<id>.
const q = (value: string) => encodeURIComponent(value);

export const pages = {
  caseView: (id: string) => `/reports/view?id=${q(id)}`,
  caseEdit: (id: string) => `/reports/edit?id=${q(id)}`,
  caseChat: (id: string) => `/reports/chat?id=${q(id)}`,
  caseSubmit: (id: string) => `/reports/submit?id=${q(id)}`,
  reviewCase: (id: string) => `/review/case?id=${q(id)}`,
  fileView: (path: string) => `/files/view?path=${q(path)}`,
};

/** API paths of signed-in-only files. */
export const files = {
  casePdf: (caseId: string, version?: number) => `/cases/${q(caseId)}/pdf${version ? `?version=${version}` : ""}`,
  document: (caseId: string, documentId: string) => `/cases/${q(caseId)}/documents/${q(documentId)}`,
};
