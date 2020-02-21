import { CrateDependency, CratePackage, CratesTarget } from '../crates';
import { NoneArtifactProvider } from '../../artifact_providers/none';

jest.mock('../../utils/system');

function cratePackageFactory(name: string): CratePackage {
  return {
    dependencies: [],
    id: name,
    manifest_path: '',
    name,
    version: '1.0.0',
  };
}

function cratePackageToDependency(cratePackage: CratePackage): CrateDependency {
  return {
    name: cratePackage.name,
    req: '1.0.0',
  };
}

describe('getPublishOrder', () => {
  process.env.CRATES_IO_TOKEN = 'xxx';
  const target = new CratesTarget({}, new NoneArtifactProvider());

  test('sorts crate packages properly', async () => {
    const packages = ['p1', 'p2', 'p3', 'p4'].map(cratePackageFactory);
    const [p1, p2, p3, p4] = packages;
    p1.dependencies = [p2, p3].map(cratePackageToDependency);
    p3.dependencies = [p4].map(cratePackageToDependency);
    const sortedPackages = [p2, p4, p3, p1];

    expect(target.getPublishOrder(packages)).toEqual(sortedPackages);
  });

  test('does not fail on a single package', async () => {
    const packages = [cratePackageFactory('p1')];
    expect(target.getPublishOrder(packages)).toEqual(packages);
  });
});
