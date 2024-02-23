import { promises as fs } from "fs";
import path from "path";

const basePath = path.resolve(process.cwd());

type PageObj = {
  appRelativePath: string;
  route: string;
  params: string[];
  hasPageContext: boolean;
  pageContextAs: string;
};

export async function core() {
  const nextConfig = (await import(`${basePath}/next.config.js`)).default;
  const pageExtensions: string[] = nextConfig.pageExtensions ?? [
    "tsx",
    "ts",
    "jsx",
    "js",
  ];

  const files = await listFiles(path.resolve(basePath, "src", "app"));
  const pageFiles = files.filter((file) =>
    pageExtensions.some((ext) => file.endsWith(`page.${ext}`)),
  );
  const pageObjs: PageObj[] = (
    await Promise.all(
      pageFiles.map(async (file): Promise<PageObj> => {
        const appRelativePath = file
          .replace(basePath, "")
          .replace("/src/app", "");
        const route =
          appRelativePath
            .replace(/\/\([^()]+\)/g, "")
            .replace(/\/page.[^/]+$/, "") || "/";
        const params =
          route
            .match(/\[[^\[\]]+\]/g)
            ?.map((param) => param.replace(/\[|\]/g, "")) ?? [];
        const text = await fs.readFile(file, "utf-8");
        const hasPageContext =
          text.includes("export type PageContext") ||
          text.includes("export interface PageContext");

        return {
          appRelativePath,
          route,
          params,
          hasPageContext,
          pageContextAs:
            "PageContext" + route.replace(/\//g, "_").replace(/[\[\]\-~]/g, ""),
        };
      }),
    )
  ).sort((a, z) => (a.route > z.route ? 1 : -1));

  const script = generateScript(pageObjs);
  await fs.writeFile(path.resolve(basePath, "src", "lib", "$route.ts"), script);
}

function generateScript(pageObjs: PageObj[]) {
  const script = `/* eslint-disable */

${pageObjs
  .filter((page) => page.hasPageContext)
  .map(
    (page) =>
      `import { PageContext as ${
        page.pageContextAs
      } } from '../app${page.appRelativePath.replace(/\.tsx$/, "")}'`,
  )
  .join("\n")}

type PageContext = {
  params?: Record<string, string>,
  searchParams?: Record<string, string>,
  hash?: string,
}

type PageContextHash = {
  hash?: string,
}

function makePath(pathname: string, pageContext?: PageContext): string {
  const path = pathname.replace(/\\[[^\\[\\]]+\]/g, (match) => {
    const key = match.replace(/\\[|\\]/g, '')
    return encodeURIComponent(pageContext?.params?.[key] || '')
  })
  const search = new URLSearchParams(pageContext?.searchParams).toString()
  const hash = pageContext?.hash ? '#' + pageContext?.hash : ''
  return path + (search ? '?' + search : '') + hash
}

export const pagesPath = {
  ${pageObjs
    .map((page) => {
      if (page.hasPageContext) {
        return `'${page.route}': (pageContext: ${page.pageContextAs} & PageContextHash) => makePath('${page.route}', pageContext)`;
      }
      return `'${page.route}': (pageContext?: PageContextHash) => makePath('${page.route}', pageContext)`;
    })
    .join(",\n  ")}
}
`;
  return script;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.resolve(dir, entry.name);
      if (entry.isDirectory()) {
        return listFiles(absolutePath);
      } else {
        return [absolutePath];
      }
    }),
  );
  return files.flat();
}
