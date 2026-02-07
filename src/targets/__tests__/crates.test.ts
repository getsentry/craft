import { vi } from 'vitest';
import { CrateDependency, CratePackage, CratesTarget } from '../crates';
import { NoneArtifactProvider } from '../../artifact_providers/none';

vi.mock('../../utils/system');

function cratePackageFactory(name: string): CratePackage {
  return {
    dependencies: [],
    id: name,
    manifest_path: '',
    name,
    version: '1.0.0',
    publish: null,
  };
}

function cratePackageToDependency(cratePackage: CratePackage): CrateDependency {
  return {
    name: cratePackage.name,
    req: '1.0.0',
    kind: null,
  };
}

function makeDev(dependency: CrateDependency): CrateDependency {
  return {
    ...dependency,
    kind: 'dev',
  };
}

describe('getPublishOrder', () => {
  process.env.CRATES_IO_TOKEN = 'xxx';
  const target = new CratesTarget(
    {
      name: 'crates',
      noDevDeps: true,
    },
    new NoneArtifactProvider(),
    { owner: 'getsentry', repo: 'craft' },
  );

  test('sorts crate packages properly', () => {
    const packages = ['p1', 'p2', 'p3', 'p4'].map(cratePackageFactory);
    const [p1, p2, p3, p4] = packages;
    p1.dependencies = [p2, p3].map(cratePackageToDependency);
    p3.dependencies = [p4].map(cratePackageToDependency);
    const sortedPackages = [p2, p4, p3, p1];

    expect(target.getPublishOrder(packages)).toEqual(sortedPackages);
  });

  test('does not fail on a single package', () => {
    const packages = [cratePackageFactory('p1')];
    expect(target.getPublishOrder(packages)).toEqual(packages);
  });

  test('errors on circular dependencies', () => {
    const packages = ['p1', 'p2'].map(cratePackageFactory);
    const [p1, p2] = packages;

    p1.dependencies = [cratePackageToDependency(p2)];
    p2.dependencies = [cratePackageToDependency(p1)];

    expect(() => target.getPublishOrder(packages)).toThrowError(Error);
  });

  test('excludes dev dependencies', () => {
    const packages = ['p1', 'p2'].map(cratePackageFactory);
    const [p1, p2] = packages;

    p1.dependencies = [cratePackageToDependency(p2)];
    p2.dependencies = [makeDev(cratePackageToDependency(p1))];

    const sortedPackages = [p2, p1];
    expect(target.getPublishOrder(packages)).toEqual(sortedPackages);
  });
});
