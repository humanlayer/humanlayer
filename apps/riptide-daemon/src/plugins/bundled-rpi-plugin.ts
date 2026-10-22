/**
 * Bundled RPI Plugin - Embedded at compile time via Bun's file import attribute
 *
 * These imports embed the file contents into the compiled binary.
 * The import returns a path string that can be read with Bun.file().
 *
 * To add a new skill:
 * 1. Add imports for all files in the skill directory
 * 2. Add entries to embeddedFiles mapping relative paths to imports
 */

// Plugin manifest
import pluginJson from '../../../riptide-rpi-claude-plugin/.claude-plugin/plugin.json' with { type: 'file' }
// License file
// @ts-expect-error - Bun import attribute
import licenseFile from '../../../riptide-rpi-claude-plugin/LICENSE' with { type: 'file' }
// ci-commit skill
// @ts-expect-error - Bun import attribute
import ciCommitSkill from '../../../riptide-rpi-claude-plugin/skills/ci-commit/SKILL.md' with { type: 'file' }
// configure-workspaces skill
// @ts-expect-error - Bun import attribute
import configureWorkspacesSkill from '../../../riptide-rpi-claude-plugin/skills/configure-workspaces/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createDesignDiscussionFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/create-design-discussion/references/design_discussion_final_answer.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createDesignDiscussionFinalAnswerResolved from '../../../riptide-rpi-claude-plugin/skills/create-design-discussion/references/design_discussion_final_answer_resolved.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createDesignDiscussionTemplate from '../../../riptide-rpi-claude-plugin/skills/create-design-discussion/references/design_discussion_template.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createDesignDiscussionShowMeReference from '../../../riptide-rpi-claude-plugin/skills/create-design-discussion/references/show-me.md' with { type: 'file' }
// create-design-discussion skill
// @ts-expect-error - Bun import attribute
import createDesignDiscussionSkill from '../../../riptide-rpi-claude-plugin/skills/create-design-discussion/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createPlanFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/create-plan/references/plan_final_answer.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createPlanFinalAnswerDisabled from '../../../riptide-rpi-claude-plugin/skills/create-plan/references/plan_final_answer_disabled.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createPlanFinalAnswerInWorktree from '../../../riptide-rpi-claude-plugin/skills/create-plan/references/plan_final_answer_in_worktree.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createPlanTemplate from '../../../riptide-rpi-claude-plugin/skills/create-plan/references/plan_template.md' with { type: 'file' }
// create-plan skill
// @ts-expect-error - Bun import attribute
import createPlanSkill from '../../../riptide-rpi-claude-plugin/skills/create-plan/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createPrdFinalAnswerResolved from '../../../riptide-rpi-claude-plugin/skills/create-prd/references/prd_final_answer_resolved.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createPrdTemplate from '../../../riptide-rpi-claude-plugin/skills/create-prd/references/prd_template.md' with { type: 'file' }
// create-prd skill
// @ts-expect-error - Bun import attribute
import createPrdSkill from '../../../riptide-rpi-claude-plugin/skills/create-prd/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createResearchQuestionsFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/create-research-questions/references/research_questions_final_answer.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createResearchQuestionsTemplate from '../../../riptide-rpi-claude-plugin/skills/create-research-questions/references/research_questions_template.md' with { type: 'file' }
// create-research-questions skill
// @ts-expect-error - Bun import attribute
import createResearchQuestionsSkill from '../../../riptide-rpi-claude-plugin/skills/create-research-questions/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createResearchFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/create-research/references/research_final_answer.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createResearchTemplate from '../../../riptide-rpi-claude-plugin/skills/create-research/references/research_template.md' with { type: 'file' }
// create-research skill
// @ts-expect-error - Bun import attribute
import createResearchSkill from '../../../riptide-rpi-claude-plugin/skills/create-research/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createStructureOutlineShowMeReference from '../../../riptide-rpi-claude-plugin/skills/create-structure-outline/references/show-me.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createStructureOutlineFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/create-structure-outline/references/structure_outline_final_answer.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createStructureOutlineFinalAnswerInWorktree from '../../../riptide-rpi-claude-plugin/skills/create-structure-outline/references/structure_outline_final_answer_in_worktree.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createStructureOutlineTemplate from '../../../riptide-rpi-claude-plugin/skills/create-structure-outline/references/structure_outline_template.md' with { type: 'file' }
// create-structure-outline skill
// @ts-expect-error - Bun import attribute
import createStructureOutlineSkill from '../../../riptide-rpi-claude-plugin/skills/create-structure-outline/SKILL.md' with { type: 'file' }
// Note: .html resolves to Bun's HTMLBundle type, but `type: 'file'` yields a path string at runtime.
import createTddArtifactTemplate from '../../../riptide-rpi-claude-plugin/skills/create-tdd/references/artifact_template.html' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createTddFinalAnswerResolved from '../../../riptide-rpi-claude-plugin/skills/create-tdd/references/tdd_final_answer_resolved.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import createTddTemplate from '../../../riptide-rpi-claude-plugin/skills/create-tdd/references/tdd_template.md' with { type: 'file' }
// create-tdd skill
// @ts-expect-error - Bun import attribute
import createTddSkill from '../../../riptide-rpi-claude-plugin/skills/create-tdd/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import describePrFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/describe-pr/references/describe_pr_final_answer.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import describePrTemplate from '../../../riptide-rpi-claude-plugin/skills/describe-pr/references/pr_description_template.md' with { type: 'file' }
// Note: .html resolves to Bun's HTMLBundle type, but `type: 'file'` yields a path string at runtime.
import describePrWalkthroughExample from '../../../riptide-rpi-claude-plugin/skills/describe-pr/references/pr_walkthrough_example.html' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import describePrShowMeReference from '../../../riptide-rpi-claude-plugin/skills/describe-pr/references/show-me.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import describePrInjectWalkthroughDiffsScript from '../../../riptide-rpi-claude-plugin/skills/describe-pr/scripts/inject-walkthrough-diffs.sh' with { type: 'file' }
// describe-pr skill
// @ts-expect-error - Bun import attribute
import describePrSkill from '../../../riptide-rpi-claude-plugin/skills/describe-pr/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import implementOutlineFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/implement-outline/references/implement_outline_final_answer.md' with { type: 'file' }
// implement-outline skill
// @ts-expect-error - Bun import attribute
import implementOutlineSkill from '../../../riptide-rpi-claude-plugin/skills/implement-outline/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import implementPlanFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/implement-plan/references/implement_plan_final_answer.md' with { type: 'file' }
// implement-plan skill
// @ts-expect-error - Bun import attribute
import implementPlanSkill from '../../../riptide-rpi-claude-plugin/skills/implement-plan/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import iterateDesignDiscussionFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/iterate-design-discussion/references/design_discussion_final_answer.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import iterateDesignDiscussionFinalAnswerResolved from '../../../riptide-rpi-claude-plugin/skills/iterate-design-discussion/references/design_discussion_final_answer_resolved.md' with { type: 'file' }
// iterate-design-discussion skill
// @ts-expect-error - Bun import attribute
import iterateDesignDiscussionSkill from '../../../riptide-rpi-claude-plugin/skills/iterate-design-discussion/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import iterateImplementationFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/iterate-implementation/references/iterate_implementation_final_answer.md' with { type: 'file' }
// iterate-implementation skill
// @ts-expect-error - Bun import attribute
import iterateImplementationSkill from '../../../riptide-rpi-claude-plugin/skills/iterate-implementation/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import iteratePlanFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/iterate-plan/references/plan_final_answer.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import iteratePlanFinalAnswerDisabled from '../../../riptide-rpi-claude-plugin/skills/iterate-plan/references/plan_final_answer_disabled.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import iteratePlanFinalAnswerInWorktree from '../../../riptide-rpi-claude-plugin/skills/iterate-plan/references/plan_final_answer_in_worktree.md' with { type: 'file' }
// iterate-plan skill
// @ts-expect-error - Bun import attribute
import iteratePlanSkill from '../../../riptide-rpi-claude-plugin/skills/iterate-plan/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import iteratePrdFinalAnswerResolved from '../../../riptide-rpi-claude-plugin/skills/iterate-prd/references/prd_final_answer_resolved.md' with { type: 'file' }
// iterate-prd skill
// @ts-expect-error - Bun import attribute
import iteratePrdSkill from '../../../riptide-rpi-claude-plugin/skills/iterate-prd/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import iterateResearchQuestionsFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/iterate-research-questions/references/research_questions_final_answer.md' with { type: 'file' }
// iterate-research-questions skill
// @ts-expect-error - Bun import attribute
import iterateResearchQuestionsSkill from '../../../riptide-rpi-claude-plugin/skills/iterate-research-questions/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import iterateResearchFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/iterate-research/references/research_final_answer.md' with { type: 'file' }
// iterate-research skill
// @ts-expect-error - Bun import attribute
import iterateResearchSkill from '../../../riptide-rpi-claude-plugin/skills/iterate-research/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import iterateStructureOutlineFinalAnswer from '../../../riptide-rpi-claude-plugin/skills/iterate-structure-outline/references/structure_outline_final_answer.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import iterateStructureOutlineFinalAnswerInWorktree from '../../../riptide-rpi-claude-plugin/skills/iterate-structure-outline/references/structure_outline_final_answer_in_worktree.md' with { type: 'file' }
// iterate-structure-outline skill
// @ts-expect-error - Bun import attribute
import iterateStructureOutlineSkill from '../../../riptide-rpi-claude-plugin/skills/iterate-structure-outline/SKILL.md' with { type: 'file' }
// Note: .html resolves to Bun's HTMLBundle type, but `type: 'file'` yields a path string at runtime.
import iterateTddArtifactTemplate from '../../../riptide-rpi-claude-plugin/skills/iterate-tdd/references/artifact_template.html' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import iterateTddFinalAnswerResolved from '../../../riptide-rpi-claude-plugin/skills/iterate-tdd/references/tdd_final_answer_resolved.md' with { type: 'file' }
// iterate-tdd skill
// @ts-expect-error - Bun import attribute
import iterateTddSkill from '../../../riptide-rpi-claude-plugin/skills/iterate-tdd/SKILL.md' with { type: 'file' }
// @ts-expect-error - Bun import attribute
import reviewArtifactCommentsXmlFormat from '../../../riptide-rpi-claude-plugin/skills/review-artifact-comments/references/comment_xml_format.md' with { type: 'file' }
// review-artifact-comments skill
// @ts-expect-error - Bun import attribute
import reviewArtifactCommentsSkill from '../../../riptide-rpi-claude-plugin/skills/review-artifact-comments/SKILL.md' with { type: 'file' }
// setup-worktree skill
// @ts-expect-error - Bun import attribute
import setupWorktreeSkill from '../../../riptide-rpi-claude-plugin/skills/setup-worktree/SKILL.md' with { type: 'file' }
import { parseBundledFilePath, readBundledPluginManifest } from './bundled-file'

const rpiPluginManifest = await readBundledPluginManifest(pluginJson)

/**
 * Plugin version - read from the embedded plugin.json so it cannot drift.
 * The committed manifest holds a base version; release builds stamp a derived
 * version (base + merges touching plugin content) before bundling, so every
 * plugin content change ships under a new version with no manual bump
 * (see ci-scripts/stamp-plugin-versions.ts).
 */
export const PLUGIN_VERSION = rpiPluginManifest.version

/**
 * Mapping of relative paths to embedded file paths
 * Keys are the path within the plugin directory structure
 * Values are the Bun-resolved embedded paths (can be read with Bun.file())
 */
export const embeddedFiles = {
	// License file
	LICENSE: licenseFile,

	// Plugin manifest
	'.claude-plugin/plugin.json': parseBundledFilePath(pluginJson),

	// configure-workspaces
	'skills/configure-workspaces/SKILL.md': configureWorkspacesSkill,

	// create-plan
	'skills/create-plan/SKILL.md': createPlanSkill,
	'skills/create-plan/references/plan_template.md': createPlanTemplate,
	'skills/create-plan/references/plan_final_answer.md': createPlanFinalAnswer,
	'skills/create-plan/references/plan_final_answer_disabled.md': createPlanFinalAnswerDisabled,
	'skills/create-plan/references/plan_final_answer_in_worktree.md': createPlanFinalAnswerInWorktree,

	// iterate-plan
	'skills/iterate-plan/SKILL.md': iteratePlanSkill,
	'skills/iterate-plan/references/plan_final_answer.md': iteratePlanFinalAnswer,
	'skills/iterate-plan/references/plan_final_answer_disabled.md': iteratePlanFinalAnswerDisabled,
	'skills/iterate-plan/references/plan_final_answer_in_worktree.md': iteratePlanFinalAnswerInWorktree,

	// create-research
	'skills/create-research/SKILL.md': createResearchSkill,
	'skills/create-research/references/research_template.md': createResearchTemplate,
	'skills/create-research/references/research_final_answer.md': createResearchFinalAnswer,

	// iterate-research
	'skills/iterate-research/SKILL.md': iterateResearchSkill,
	'skills/iterate-research/references/research_final_answer.md': iterateResearchFinalAnswer,

	// create-research-questions
	'skills/create-research-questions/SKILL.md': createResearchQuestionsSkill,
	'skills/create-research-questions/references/research_questions_template.md': createResearchQuestionsTemplate,
	'skills/create-research-questions/references/research_questions_final_answer.md':
		createResearchQuestionsFinalAnswer,

	// iterate-research-questions
	'skills/iterate-research-questions/SKILL.md': iterateResearchQuestionsSkill,
	'skills/iterate-research-questions/references/research_questions_final_answer.md':
		iterateResearchQuestionsFinalAnswer,

	// create-design-discussion
	'skills/create-design-discussion/SKILL.md': createDesignDiscussionSkill,
	'skills/create-design-discussion/references/design_discussion_template.md': createDesignDiscussionTemplate,
	'skills/create-design-discussion/references/design_discussion_final_answer.md': createDesignDiscussionFinalAnswer,
	'skills/create-design-discussion/references/design_discussion_final_answer_resolved.md':
		createDesignDiscussionFinalAnswerResolved,
	'skills/create-design-discussion/references/show-me.md': createDesignDiscussionShowMeReference,

	// iterate-design-discussion
	'skills/iterate-design-discussion/SKILL.md': iterateDesignDiscussionSkill,
	'skills/iterate-design-discussion/references/design_discussion_final_answer.md': iterateDesignDiscussionFinalAnswer,
	'skills/iterate-design-discussion/references/design_discussion_final_answer_resolved.md':
		iterateDesignDiscussionFinalAnswerResolved,

	// create-structure-outline
	'skills/create-structure-outline/SKILL.md': createStructureOutlineSkill,
	'skills/create-structure-outline/references/structure_outline_template.md': createStructureOutlineTemplate,
	'skills/create-structure-outline/references/structure_outline_final_answer.md': createStructureOutlineFinalAnswer,
	'skills/create-structure-outline/references/structure_outline_final_answer_in_worktree.md':
		createStructureOutlineFinalAnswerInWorktree,
	'skills/create-structure-outline/references/show-me.md': createStructureOutlineShowMeReference,

	// iterate-structure-outline
	'skills/iterate-structure-outline/SKILL.md': iterateStructureOutlineSkill,
	'skills/iterate-structure-outline/references/structure_outline_final_answer.md': iterateStructureOutlineFinalAnswer,
	'skills/iterate-structure-outline/references/structure_outline_final_answer_in_worktree.md':
		iterateStructureOutlineFinalAnswerInWorktree,

	// implement-plan
	'skills/implement-plan/SKILL.md': implementPlanSkill,
	'skills/implement-plan/references/implement_plan_final_answer.md': implementPlanFinalAnswer,

	// implement-outline
	'skills/implement-outline/SKILL.md': implementOutlineSkill,
	'skills/implement-outline/references/implement_outline_final_answer.md': implementOutlineFinalAnswer,

	// iterate-implementation
	'skills/iterate-implementation/SKILL.md': iterateImplementationSkill,
	'skills/iterate-implementation/references/iterate_implementation_final_answer.md': iterateImplementationFinalAnswer,

	// setup-worktree
	'skills/setup-worktree/SKILL.md': setupWorktreeSkill,

	// ci-commit
	'skills/ci-commit/SKILL.md': ciCommitSkill,

	// describe-pr
	'skills/describe-pr/SKILL.md': describePrSkill,
	'skills/describe-pr/references/pr_description_template.md': describePrTemplate,
	'skills/describe-pr/references/show-me.md': describePrShowMeReference,
	'skills/describe-pr/references/pr_walkthrough_example.html': parseBundledFilePath(describePrWalkthroughExample),
	'skills/describe-pr/references/describe_pr_final_answer.md': describePrFinalAnswer,
	'skills/describe-pr/scripts/inject-walkthrough-diffs.sh': describePrInjectWalkthroughDiffsScript,

	// review-artifact-comments
	'skills/review-artifact-comments/SKILL.md': reviewArtifactCommentsSkill,
	'skills/review-artifact-comments/references/comment_xml_format.md': reviewArtifactCommentsXmlFormat,

	// create-prd
	'skills/create-prd/SKILL.md': createPrdSkill,
	'skills/create-prd/references/prd_template.md': createPrdTemplate,
	'skills/create-prd/references/prd_final_answer_resolved.md': createPrdFinalAnswerResolved,

	// iterate-prd
	'skills/iterate-prd/SKILL.md': iteratePrdSkill,
	'skills/iterate-prd/references/prd_final_answer_resolved.md': iteratePrdFinalAnswerResolved,

	// create-tdd
	'skills/create-tdd/SKILL.md': createTddSkill,
	'skills/create-tdd/references/tdd_template.md': createTddTemplate,
	'skills/create-tdd/references/artifact_template.html': parseBundledFilePath(createTddArtifactTemplate),
	'skills/create-tdd/references/tdd_final_answer_resolved.md': createTddFinalAnswerResolved,

	// iterate-tdd
	'skills/iterate-tdd/SKILL.md': iterateTddSkill,
	'skills/iterate-tdd/references/artifact_template.html': parseBundledFilePath(iterateTddArtifactTemplate),
	'skills/iterate-tdd/references/tdd_final_answer_resolved.md': iterateTddFinalAnswerResolved,
}
