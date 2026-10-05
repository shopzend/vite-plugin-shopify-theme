import { spawnSync } from "node:child_process";
import { isBuildOutputAsset } from "../plugins/config";

export class ThemeMergeError extends Error {}

// 依次把提交合并进 Theme Target 当前分支：除最后一个外合并后即提交，最后一个保持未提交，
// 让随后的 build 产物进入同一合并提交。只涉及插件生成文件的冲突取合并前当前分支的状态
// （不存在则删除），由随后的 build 重建；其余冲突与合并前即失败的 Git 错误一律失败。
// 返回自动处理的冲突路径。
export function mergeCommits(themePath: string, commits: string[], snippet: string): string[] {
  const git = (args: string[], allowFailure = false) => {
    const result = spawnSync("git", ["-C", themePath, ...args], { encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0 && !allowFailure) {
      throw new ThemeMergeError(`git ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
    }
    return result;
  };
  const merging = () => git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], true).status === 0;
  const unmerged = () => [
    ...new Set(
      // `:/` 覆盖整个仓库：主题位于子目录时，主题外的冲突以 `../` 路径出现并按源码冲突失败。
      git(["ls-files", "-u", "-z", "--", ":/"])
        .stdout.split("\0")
        .filter(Boolean)
        .map((entry) => entry.slice(entry.indexOf("\t") + 1)),
    ),
  ];
  const generated = (path: string) =>
    path === `snippets/${snippet}` ||
    (path.startsWith("assets/") && isBuildOutputAsset(path.slice("assets/".length)));

  const resolved: string[] = [];
  commits.forEach((commit, index) => {
    const result = git(["merge", "--no-ff", "--no-commit", commit], true);
    if (result.status !== 0) {
      const output = `${result.stdout}${result.stderr}`;
      if (!merging()) {
        throw new ThemeMergeError(
          `merging ${commit} failed before reaching a conflict state:\n${output}`,
        );
      }
      const conflicts = unmerged();
      const source = conflicts.filter((path) => !generated(path));
      if (conflicts.length === 0 || source.length > 0) {
        const listed = (source.length > 0 ? source : ["(no unmerged paths)"]).map((p) => `  ${p}`);
        throw new ThemeMergeError(
          `merging ${commit} has conflicts that need a source fix:\n${listed.join("\n")}\n${output}`,
        );
      }
      for (const path of conflicts) {
        // `HEAD:<path>` 默认相对仓库根，`./` 让它与 ls-files 输出一样相对 Theme Target。
        if (git(["cat-file", "-e", `HEAD:./${path}`], true).status === 0) {
          git(["checkout", "HEAD", "--", path]);
        } else {
          git(["rm", "-q", "-f", "--", path]);
        }
      }
      const left = unmerged();
      if (left.length > 0) {
        throw new ThemeMergeError(
          `unresolved paths remain after merging ${commit}:\n${left.join("\n")}`,
        );
      }
      resolved.push(...conflicts.map((path) => `${path} (${commit.slice(0, 7)})`));
    }
    if (index < commits.length - 1 && merging()) git(["commit", "--no-edit"]);
  });
  return resolved;
}
