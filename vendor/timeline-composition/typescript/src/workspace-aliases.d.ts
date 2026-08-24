/**
 * Type boundary for generated workspace-primitive registry imports.
 *
 * The runtime resolves these specifiers to workspace or vendored source via
 * bundler aliases. Registry consumers depend only on the stable public
 * component contracts, not on the source workspace's private relative imports.
 */
type BanodocoWorkspaceEffectComponent =
  import('./effects-types').EffectComponent;
type BanodocoWorkspaceAnimationComponent =
  import('./effects-types').AnimationComponent;
type BanodocoWorkspaceTransitionComponent =
  import('./effects-types').TransitionComponent;

declare module '@workspace-effects/*' {
  const component: BanodocoWorkspaceEffectComponent;
  export default component;
}

declare module '@workspace-animations/*' {
  const component: BanodocoWorkspaceAnimationComponent;
  export default component;
}

declare module '@workspace-transitions/*' {
  const component: BanodocoWorkspaceTransitionComponent;
  export default component;
}
