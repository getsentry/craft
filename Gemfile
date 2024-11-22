# Gemfile
# Pin CocoaPods Version to avoid that bugs in CocoaPods like
# https://github.com/CocoaPods/CocoaPods/issues/12081 break our release
# workflow.
# 1.16.2 has a bug that breaks the release workflow. Publishing with craft then
# fails with:
# - ERROR | [iOS] unknown: Encountered an unknown error (Unable to locate the
#   executable `rsync`) during validation.
# This could be related to https://github.com/CocoaPods/CocoaPods/issues/12674.
# Therefore, we stick to 1.14.2.
gem "cocoapods", "= 1.14.2"
