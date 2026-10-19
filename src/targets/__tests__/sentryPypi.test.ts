import { WHEEL_REGEX, uniquePackages } from '../sentryPypi';

describe('WHEEL_REGEX', () => {
  it('matches a wheel filename', () => {
    const filename = 'pkg_name-1.2.3-py3-none-any.whl';
    const match = WHEEL_REGEX.exec(filename) as RegExpExecArray;
    expect(match[0]).toEqual(filename);
    expect(match[1]).toEqual('pkg_name');
    expect(match[2]).toEqual('1.2.3');
  });

  it('does not match an sdist', () => {
    expect(WHEEL_REGEX.exec('pkg-name-123.tar.gz')).toEqual(null);
  });

  it('does not match wheel build numbers', () => {
    expect(WHEEL_REGEX.exec('pkg_name-1.2.3-1-py3-none-any.whl')).toEqual(null);
  });
});

describe('uniquePackages', () => {
  it('reproduces the trivial list', () => {
    expect(uniquePackages([])).toEqual([]);
  });

  it('translates wheels to ==', () => {
    expect(uniquePackages(['pkg-1-py3-none-any.whl'])).toEqual(['pkg==1']);
  });

  it('dedupes packages', () => {
    const ret = uniquePackages([
      'pkg-1-py3-none-any.whl',
      'pkg-1-py2-none-any.whl',
    ]);
    expect(ret).toEqual(['pkg==1']);
  });

  it('sorts the output', () => {
    const ret = uniquePackages([
      'b-1-py3-none-any.whl',
      'a-2-py3-none-any.whl',
    ]);
    expect(ret).toEqual(['a==2', 'b==1']);
  });
});
