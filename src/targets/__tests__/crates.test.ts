import { ZeusStore } from '../../stores/zeus';
import { CrateDependency, CratePackage, CratesTarget } from '../crates';

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
  const store = new ZeusStore('craft-test', 'craft-test-repo');
  const target = new CratesTarget({}, store);

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
