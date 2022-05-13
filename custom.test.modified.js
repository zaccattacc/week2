// [assignment] please copy the entire modified custom.test.js here
const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { toFixedHex, poseidonHash } = require('../src/utils')
const { Keypair } = require('../src/keypair')
const { encodeDataForBridge } = require('./utils')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(process.env.MINIMUM_WITHDRAWAL_AMOUNT || '0.05')
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')

describe('Custom Tests', function () {
  this.timeout(30000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT,
    )
    const proxy = await deploy(
      'CrossChainUpgradeableProxy',
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId,
    )

    const tornadoPool = tornadoPoolImpl.attach(proxy.address)

    await token.approve(tornadoPool.address, utils.parseEther('10000'))

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig }
  }

  it('[assignment] ii. deposit 0.1 ETH in L1 -> withdraw 0.08 ETH in L2 -> assert balances', async () => {
      // [assignment] complete code here
      const { tornadoPool, token, omniBridge } = await loadFixture(fixture)

      // Alice deposits 0.1 ETH in L1
      const aliceKeypair = new Keypair()
      const aliceDepositAmount = utils.parseEther('0.1')
      const aliceDepositUtxo = new Utxo({ 
        amount: aliceDepositAmount,
        keypair: aliceKeypair 
      })
      const { args, extData } = await prepareTransaction({
        tornadoPool,
        outputs: [aliceDepositUtxo],
      })

      const onTokenBridgedData = encodeDataForBridge({
        proof: args,
        extData,
      })

      const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
        token.address,
        aliceDepositUtxo.amount,
        onTokenBridgedData,
      )

      // First, it sends the amount into the omnibridge and sends it to the pool
      await token.transfer(omniBridge.address, aliceDepositAmount) 
      const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)

      await omniBridge.execute([
        { who: token.address, callData: transferTx.data }, // send the tokens to the pool
        { who: tornadoPool.address, callData: onTokenBridgedTx.data },
      ])

      // Alice withdraws 0.08 ETH in L2
      const aliceWithdrawAmount = utils.parseEther('0.08')
      const aliceEthAddress = '0xDeaD00000000000000000000000000000000BEEf'
      const aliceChangeUtxo = new Utxo({ amount: aliceDepositAmount.sub(aliceWithdrawAmount), keypair: aliceKeypair})
      await transaction({
        tornadoPool,
        inputs: [aliceDepositUtxo],
        outputs: [aliceChangeUtxo],
        recipient: aliceEthAddress,
      })

      const aliceBalance = await token.balanceOf(aliceEthAddress)
      expect(aliceBalance).to.be.equal(aliceWithdrawAmount)
      const omniBridgeBalance = await token.balanceOf(omniBridge.address)
      expect(omniBridgeBalance).to.be.equal(0)
      const tornadoPoolBalance = await token.balanceOf(tornadoPool.address)
      expect(tornadoPoolBalance).to.be.equal(aliceDepositAmount.sub(aliceWithdrawAmount))

  })

  it('[assignment] iii. see assignment doc for details (Alice deposits 0.08 ETH in L1 -> Alice sends 0.05 ETH to Bob in L2 -> Bob withdraws all his funds in L2 -> Alice withdraws all her remaining funds in L1)', async () => {
      // [assignment] complete code here
      const { tornadoPool, token, omniBridge } = await loadFixture(fixture)
      const sender = (await ethers.getSigners())[0]

      // Alice deposits 0.08 ETH in L1
      const aliceKeypair = new Keypair()
      const aliceDepositAmount = utils.parseEther('0.13')
      const aliceDepositUtxo = new Utxo({ 
        amount: aliceDepositAmount,
        keypair: aliceKeypair 
      })
      const { args, extData } = await prepareTransaction({
        tornadoPool,
        outputs: [aliceDepositUtxo],
      })

      const onTokenBridgedData = encodeDataForBridge({
        proof: args,
        extData,
      })

      const onTokenBridgedTx = await tornadoPool.populateTransaction.onTokenBridged(
        token.address,
        aliceDepositUtxo.amount,
        onTokenBridgedData,
      )

      // First, it sends the amount into the omnibridge and sends it to the pool
      await token.transfer(omniBridge.address, aliceDepositAmount)
      const transferTx = await token.populateTransaction.transfer(tornadoPool.address, aliceDepositAmount)

      await omniBridge.execute([
        { who: token.address, callData: transferTx.data },
        { who: tornadoPool.address, callData: onTokenBridgedTx.data }, // Tornado Pool verifies whether the funds was sent to the omnibridge
      ])

      // Alice sends 0.06 ETH to Bob in L2
      const bobKeypair = new Keypair()
      const bobAddress = bobKeypair.address()
      const bobSendAmount = utils.parseEther('0.06')
      let bobSendUtxo = new Utxo({
        amount: bobSendAmount,
        keypair: Keypair.fromString(bobAddress),
      })
      const aliceChangeUtxo = new Utxo({
        amount: aliceDepositAmount.sub(bobSendAmount),
        keypair: aliceKeypair,
      })
      await transaction({
        tornadoPool,
        inputs: [aliceDepositUtxo],
        outputs: [bobSendUtxo, aliceChangeUtxo]
      })

      // Bob withdraws his funds in L2

      // Bob  checks for the receipt of the transaction
      const filter = tornadoPool.filters.NewCommitment()
      const fromBlock = await ethers.provider.getBlock()
      const events = await tornadoPool.queryFilter(filter, fromBlock.number)
      let bobReceiveUtxo
      try {
        bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[0].args.encryptedOutput, events[0].args.index)
      } catch (e) {
        // we try to decrypt another output here because it shuffles outputs before sending to blockchain
        bobReceiveUtxo = Utxo.decrypt(bobKeypair, events[1].args.encryptedOutput, events[1].args.index)
      }
      expect(bobReceiveUtxo.amount).to.be.equal(bobSendAmount) // Checks if the amount sent is the correct amount

      const bobWithdrawAmount = utils.parseEther('0.06')
      const bobEthAddress = '0xDeaD00000000000000000000000000000000BEEf'
      const bobChangeUtxo = new Utxo({
        amount: bobSendAmount.sub(bobWithdrawAmount),
        keypair: bobKeypair,
      })
      await transaction({
        tornadoPool,
        inputs: [bobReceiveUtxo],
        outputs: [bobChangeUtxo],
        recipient: bobEthAddress,
      })

      // Alice withdraws all her remaining funds
      const aliceWithdrawAmount = aliceChangeUtxo.amount
      const recipient = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'
      // We create a new transaction object because we can not reuse a transaction for inputs
      const aliceChangeUtxo2 = new Utxo({
        amount: (aliceChangeUtxo.amount).sub(aliceWithdrawAmount),
        keypair: aliceKeypair,
      })
      await transaction({
        tornadoPool,
        inputs: [aliceChangeUtxo],
        outputs: [aliceChangeUtxo2],
        recipient: recipient,
        isL1Withdrawal: true,
      })
      

      const aliceBalance = await token.balanceOf(recipient)
      expect(aliceBalance).to.be.equal(0)
      const bobBalance = await token.balanceOf(bobEthAddress)
      expect(bobBalance).to.be.equal(bobSendAmount)
      const omniBridgeBalance = await token.balanceOf(omniBridge.address)
      expect(omniBridgeBalance).to.be.equal(aliceWithdrawAmount)
      const tornadoPoolBalance = await token.balanceOf(tornadoPool.address)
      expect(tornadoPoolBalance).to.be.equal(0)
  })
})
